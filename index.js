const express = require('express');
const pool = require('./db');
const PORT = 3000;


const app = express();

app.use(express.json());

// Create new user
app.post('/api/users', async (req, res) => {
    const { user_strt_id, display_name } = req.body;

    if (!user_strt_id || !display_name) {
        return res.status(400).json({ error: 'Missing user_strt_id or display_name' });
    }

    try {
        const query = `
      INSERT INTO pusers (id, username)
      VALUES ($1, $2)
      RETURNING *;
    `;

        const values = [user_strt_id, display_name];
        const result = await pool.query(query, values);

        res.status(201).json({ message: 'User created', user: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            res.status(409).json({ error: 'User already exists or username is taken' });
        } else {
            console.error(err);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});


app.delete('/remove-friend', async (req, res) => {
    const { user1, user2 } = req.body;

    if (!user1 || !user2) {
        return res.status(400).json({ error: 'Both user1 and user2 are required' });
    }

    try {
        const result = await pool.query(
            `DELETE FROM connections 
       WHERE user1_id = $1 AND user2_id = $2`,
            [user1, user2]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'No connection found in that order to delete' });
        }

        res.json({ message: 'Connection removed successfully (ordered)' });
    } catch (err) {
        console.error('Error removing connection:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});



// Create a connection between two users
app.post('/api/connections', async (req, res) => {
    let { user_id_1, user_id_2 } = req.body;

    if (!user_id_1 || !user_id_2) {
        return res.status(400).json({ error: 'Both user_id_1 and user_id_2 are required' });
    }

    if (user_id_1 === user_id_2) {
        return res.status(400).json({ error: 'A user cannot connect to themselves' });
    }

    // Ensure user_id_1 < user_id_2 to maintain order and uniqueness
    if (user_id_1 > user_id_2) {
        [user_id_1, user_id_2] = [user_id_2, user_id_1];
    }

    try {
        // Check if both users exist
        const userCheckQuery = `SELECT id FROM pusers WHERE id = $1 OR id = $2`;
        const userCheckResult = await pool.query(userCheckQuery, [user_id_1, user_id_2]);

        if (userCheckResult.rows.length < 2) {
            return res.status(404).json({ error: 'One or both users not found' });
        }

        // Insert connection
        const insertQuery = `
      INSERT INTO user_connections (user_id_1, user_id_2)
      VALUES ($1, $2)
      RETURNING *;
    `;

        const result = await pool.query(insertQuery, [user_id_1, user_id_2]);

        res.status(201).json({ message: 'Connection created', connection: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            res.status(409).json({ error: 'Connection already exists' });
        } else {
            console.error(err);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});



// Get user by ID
app.get('/api/users/:id', async (req, res) => {
    const userId = req.params.id;

    try {
        const query = `
      SELECT * FROM pusers
      WHERE id = $1;
    `;

        const result = await pool.query(query, [userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ user: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all friends of a user
app.get('/api/users/:id/friends', async (req, res) => {
    const userId = req.params.id;

    try {
        const query = `
      SELECT id, username
      FROM pusers
      WHERE id IN (
          SELECT user_id_2 FROM user_connections WHERE user_id_1 = $1
          UNION
          SELECT user_id_1 FROM user_connections WHERE user_id_2 = $1
      );
    `;

        const result = await pool.query(query, [userId]);

        res.json({ friends: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/friends-of-friends/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const result = await pool.query(`
      SELECT DISTINCT 
        CASE 
          WHEN c2.user1_id = f.user_id THEN c2.user2_id 
          ELSE c2.user1_id 
        END AS fof_id
      FROM (
        SELECT 
          CASE 
            WHEN user1_id = $1 THEN user2_id 
            ELSE user1_id 
          END AS user_id
        FROM connections 
        WHERE user1_id = $1 OR user2_id = $1
      ) f
      JOIN connections c2 
        ON c2.user1_id = f.user_id OR c2.user2_id = f.user_id
      WHERE 
        $1 NOT IN (c2.user1_id, c2.user2_id)
        AND (
          CASE 
            WHEN c2.user1_id = f.user_id THEN c2.user2_id 
            ELSE c2.user1_id 
          END
        ) NOT IN (
          SELECT 
            CASE 
              WHEN user1_id = $1 THEN user2_id 
              ELSE user1_id 
            END
          FROM connections 
          WHERE user1_id = $1 OR user2_id = $1
        );
    `, [userId]);

        res.json({ friendsOfFriends: result.rows.map(row => row.fof_id) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch friends of friends' });
    }
});


// Get mutual connections between two users
app.get('/api/connections/mutual/:userA/:userB', async (req, res) => {
    const { userA, userB } = req.params;

    if (userA === userB) {
        return res.status(400).json({ error: 'User IDs must be different' });
    }

    try {
        const query = `
      SELECT id, username
      FROM pusers
      WHERE id IN (
          SELECT CASE
                   WHEN user_id_1 = $1 THEN user_id_2
                   ELSE user_id_1
                 END
          FROM user_connections
          WHERE user_id_1 = $1 OR user_id_2 = $1
      )
      AND id IN (
          SELECT CASE
                   WHEN user_id_1 = $2 THEN user_id_2
                   ELSE user_id_1
                 END
          FROM user_connections
          WHERE user_id_1 = $2 OR user_id_2 = $2
      );
    `;

        const result = await pool.query(query, [userA, userB]);

        res.json({ mutualConnections: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
