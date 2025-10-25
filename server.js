const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const app = express();

// Use environment port for Railway or 3000 for local
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static('.'));

// Initialize SQLite Database
const db = new sqlite3.Database('./foodly.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        
        // Create tables
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            items TEXT NOT NULL,
            total REAL NOT NULL,
            order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (username) REFERENCES users (username)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS cart_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            item_id INTEGER NOT NULL,
            item_name TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            price REAL NOT NULL,
            added_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (username) REFERENCES users (username)
        )`);
    }
});

// Routes

// User login/registration
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    // Check if user exists
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (row) {
            // User exists, just return success (no password validation as per requirements)
            res.json({ message: 'Login successful', username });
        } else {
            // Create new user
            db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, password], function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Failed to create user' });
                }
                res.json({ message: 'User created and login successful', username });
            });
        }
    });
});

// Place order
app.post('/api/order', (req, res) => {
    const { username, items, total } = req.body;

    if (!username || !items || !total) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const itemsJson = JSON.stringify(items);

    db.run('INSERT INTO orders (username, items, total) VALUES (?, ?, ?)', 
        [username, itemsJson, total], 
        function(err) {
            if (err) {
                console.error('Order error:', err);
                return res.status(500).json({ error: 'Failed to place order' });
            }

            // Save cart items to history
            items.forEach(item => {
                db.run(
                    'INSERT INTO cart_history (username, item_id, item_name, quantity, price) VALUES (?, ?, ?, ?, ?)',
                    [username, item.id, item.name, item.quantity, item.price]
                );
            });

            res.json({ 
                message: 'Order placed successfully', 
                orderId: this.lastID,
                total: total
            });
        });
});

// Get user orders
app.get('/api/orders/:username', (req, res) => {
    const { username } = req.params;

    db.all('SELECT * FROM orders WHERE username = ? ORDER BY order_date DESC', [username], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(rows);
    });
});

// Get cart history
app.get('/api/cart-history/:username', (req, res) => {
    const { username } = req.params;

    db.all('SELECT * FROM cart_history WHERE username = ? ORDER BY added_date DESC', [username], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(rows);
    });
});

// Add this simple admin route to check database
app.get('/admin', (req, res) => {
    // Get all data from all tables
    db.all(`SELECT 'users' as table_name, COUNT(*) as count FROM users
            UNION ALL 
            SELECT 'orders' as table_name, COUNT(*) as count FROM orders
            UNION ALL
            SELECT 'cart_history' as table_name, COUNT(*) as count FROM cart_history`, (err, counts) => {
        
        if (err) {
            return res.status(500).send('Database error: ' + err.message);
        }

        let html = `
        <html>
        <head><title>Foodly DB Check</title></head>
        <body style="font-family: Arial; margin: 20px;">
            <h1>🍕 Foodly Database Status</h1>
            <h3>Table Counts:</h3>
            <ul>
        `;

        counts.forEach(row => {
            html += `<li><b>${row.table_name}:</b> ${row.count} records</li>`;
        });

        html += `</ul>
            <p><a href="/admin/details">View Detailed Data</a></p>
        </body>
        </html>`;

        res.send(html);
    });
});

// Detailed view
app.get('/admin/details', (req, res) => {
    // Get all data
    db.all(`SELECT * FROM users`, (err, users) => {
        db.all(`SELECT * FROM orders`, (err, orders) => {
            db.all(`SELECT * FROM cart_history`, (err, cartHistory) => {
                
                let html = `
                <html>
                <head><title>Foodly DB Details</title></head>
                <body style="font-family: Arial; margin: 20px;">
                    <h1>📊 Foodly Database Details</h1>
                    <p><a href="/admin">← Back to Summary</a></p>
                    
                    <h2>👥 Users (${users.length})</h2>
                    <table border="1" cellpadding="8">
                        <tr><th>ID</th><th>Username</th><th>Created</th></tr>
                `;

                users.forEach(user => {
                    html += `<tr><td>${user.id}</td><td>${user.username}</td><td>${user.created_at}</td></tr>`;
                });

                html += `</table>
                    
                    <h2>📦 Orders (${orders.length})</h2>
                    <table border="1" cellpadding="8">
                        <tr><th>ID</th><th>Username</th><th>Total</th><th>Date</th></tr>
                `;

                orders.forEach(order => {
                    html += `<tr><td>${order.id}</td><td>${order.username}</td><td>₹${order.total}</td><td>${order.order_date}</td></tr>`;
                });

                html += `</table>
                    
                    <h2>🛒 Cart History (${cartHistory.length})</h2>
                    <table border="1" cellpadding="8">
                        <tr><th>ID</th><th>Username</th><th>Item</th><th>Qty</th><th>Price</th></tr>
                `;

                cartHistory.forEach(item => {
                    html += `<tr><td>${item.id}</td><td>${item.username}</td><td>${item.item_name}</td><td>${item.quantity}</td><td>₹${item.price}</td></tr>`;
                });

                html += `</table></body></html>`;
                res.send(html);
            });
        });
    });
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server - Important for Railway: listen on 0.0.0.0
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Foodly server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});