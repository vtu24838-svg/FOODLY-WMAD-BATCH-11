const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const app = express();

// Use environment port for Railway
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

// Database path for Railway
const dbPath = process.env.NODE_ENV === 'production' 
  ? '/tmp/foodly.db' 
  : './foodly.db';

console.log('Using database path:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('✅ Connected to SQLite database at:', dbPath);
        
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

        console.log('✅ Database tables created/verified');
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
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (row) {
            // User exists, just return success (no password validation as per requirements)
            res.json({ message: 'Login successful', username });
        } else {
            // Create new user
            db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, password], function(err) {
                if (err) {
                    console.error('User creation error:', err);
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
                    [username, item.id, item.name, item.quantity, item.price],
                    (err) => {
                        if (err) console.error('Cart history error:', err);
                    }
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
            console.error('Orders fetch error:', err);
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
            console.error('Cart history fetch error:', err);
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
            console.error('Admin stats error:', err);
            return res.status(500).send('Database error: ' + err.message);
        }

        let html = `
        <html>
        <head>
            <title>Foodly DB Check</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
                .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                h1 { color: #333; }
                ul { list-style: none; padding: 0; }
                li { background: #e8f5e8; margin: 10px 0; padding: 15px; border-radius: 5px; border-left: 4px solid #4CAF50; }
                a { color: #007bff; text-decoration: none; }
                a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🍕 Foodly Database Status</h1>
                <p><strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}</p>
                <p><strong>Database Path:</strong> ${dbPath}</p>
                <h3>Table Counts:</h3>
                <ul>
        `;

        counts.forEach(row => {
            html += `<li><b>${row.table_name}:</b> ${row.count} records</li>`;
        });

        html += `</ul>
                <p><a href="/admin/details">📊 View Detailed Data</a></p>
                <p><a href="/">🏠 Go to Foodly App</a></p>
            </div>
        </body>
        </html>`;

        res.send(html);
    });
});

// Detailed view
app.get('/admin/details', (req, res) => {
    // Get all data
    db.all(`SELECT * FROM users`, (err, users) => {
        if (err) {
            console.error('Users fetch error:', err);
            users = [];
        }
        
        db.all(`SELECT * FROM orders`, (err, orders) => {
            if (err) {
                console.error('Orders fetch error:', err);
                orders = [];
            }
            
            db.all(`SELECT * FROM cart_history`, (err, cartHistory) => {
                if (err) {
                    console.error('Cart history fetch error:', err);
                    cartHistory = [];
                }
                
                let html = `
                <html>
                <head>
                    <title>Foodly DB Details</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
                        .container { max-width: 1200px; margin: 0 auto; }
                        table { border-collapse: collapse; width: 100%; margin: 20px 0; background: white; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                        th { background-color: #ff6b35; color: white; }
                        .section { background: white; padding: 20px; border-radius: 10px; margin: 20px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                        a { color: #007bff; text-decoration: none; }
                        a:hover { text-decoration: underline; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>📊 Foodly Database Details</h1>
                        <p><a href="/admin">← Back to Summary</a> | <a href="/">🏠 Go to Foodly App</a></p>
                        
                        <div class="section">
                            <h2>👥 Users (${users.length})</h2>
                            <table>
                                <tr><th>ID</th><th>Username</th><th>Password</th><th>Created</th></tr>
                `;

                users.forEach(user => {
                    html += `<tr><td>${user.id}</td><td>${user.username}</td><td>${user.password}</td><td>${user.created_at}</td></tr>`;
                });

                html += `</table></div>
                        
                        <div class="section">
                            <h2>📦 Orders (${orders.length})</h2>
                            <table>
                                <tr><th>ID</th><th>Username</th><th>Total</th><th>Date</th><th>Items Count</th></tr>
                `;

                orders.forEach(order => {
                    const items = order.items ? JSON.parse(order.items) : [];
                    html += `<tr><td>${order.id}</td><td>${order.username}</td><td>₹${order.total}</td><td>${order.order_date}</td><td>${items.length}</td></tr>`;
                });

                html += `</table></div>
                        
                        <div class="section">
                            <h2>🛒 Cart History (${cartHistory.length})</h2>
                            <table>
                                <tr><th>ID</th><th>Username</th><th>Item</th><th>Qty</th><th>Price</th><th>Date</th></tr>
                `;

                cartHistory.forEach(item => {
                    html += `<tr><td>${item.id}</td><td>${item.username}</td><td>${item.item_name}</td><td>${item.quantity}</td><td>₹${item.price}</td><td>${item.added_date}</td></tr>`;
                });

                html += `</table></div></div></body></html>`;
                res.send(html);
            });
        });
    });
});

// Health check route
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        database: dbPath
    });
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Foodly server running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`💾 Database path: ${dbPath}`);
    console.log(`🌐 App URL: http://0.0.0.0:${PORT}`);
    console.log(`📋 Admin panel: http://0.0.0.0:${PORT}/admin`);
    console.log(`❤️ Health check: http://0.0.0.0:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 Shutting down server...');
    db.close((err) => {
        if (err) {
            console.error('Database close error:', err.message);
        } else {
            console.log('✅ Database connection closed.');
        }
        process.exit(0);
    });
});
