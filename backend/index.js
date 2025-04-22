const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketio(server, {
    cors: {
        origin: '*',
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

mongoose.connect('mongodb://localhost:27017/rollbux', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const UserSchema = new mongoose.Schema({
    robloxUsername: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    robloxId: { type: Number },
    balance: { type: Number, default: 0 }
});
const User = mongoose.model('User', UserSchema);

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('register', async ({ robloxUsername, password }) => {
        try {
            const existingUser = await User.findOne({ robloxUsername });
            if (existingUser) {
                return socket.emit('registerError', 'Username already taken.');
            }

            const newUser = new User({ robloxUsername, password });
            await newUser.save();
            socket.emit('registerSuccess', { message: 'Registration successful!' });
        } catch (error) {
            console.error('Registration error:', error);
            socket.emit('registerError', 'Failed to register user.');
        }
    });

    socket.on('login', async ({ robloxUsername, password }) => {
        try {
            const user = await User.findOne({ robloxUsername });
            if (!user || user.password !== password) {
                return socket.emit('loginError', 'Invalid username or password.');
            }

            socket.join(user.robloxUsername);
            socket.user = user;
            socket.emit('loginSuccess', {
                message: 'Login successful!',
                user: { robloxUsername: user.robloxUsername, balance: user.balance }
            });
            console.log(`${user.robloxUsername} logged in.`);
        } catch (error) {
            console.error('Login error:', error);
            socket.emit('loginError', 'Failed to login.');
        }
    });

    socket.on('createCoinflip', async ({ robuxAmount, choice }) => {
        if (!socket.user) return socket.emit('coinflipError', 'Not logged in.');

        try {
            if (socket.user.balance < robuxAmount) {
                return socket.emit('coinflipError', 'Insufficient balance.');
            }

            socket.user.balance -= robuxAmount;
            await User.updateOne({ robloxUsername: socket.user.robloxUsername }, { balance: socket.user.balance });

            const newCoinflip = {
                host: socket.user.robloxUsername,
                robuxAmount: robuxAmount,
                choice: choice,
                timestamp: new Date(),
                available: true
            };

            socket.broadcast.emit('newCoinflip', newCoinflip);
            socket.emit('coinflipCreated', newCoinflip);
        } catch (error) {
            console.error('Coinflip creation error:', error);
            socket.emit('coinflipError', 'Failed to create coinflip.');
        }
    });

    socket.on('joinCoinflip', async ({ robloxUsername, robuxAmount, choice }) => {
        try {
            const user = await User.findOne({ robloxUsername: robloxUsername });

            if (!user) {
                return socket.emit('joinCoinflipError', 'User not found.');
            }

            if (user.balance < robuxAmount) {
                return socket.emit('joinCoinflipError', 'Insufficient balance.');
            }

            user.balance -= robuxAmount;
            await User.updateOne({ robloxUsername: robloxUsername }, { balance: user.balance });

            const flipResult = Math.random() < 0.5 ? 'Heads' : 'Tails';

            if (flipResult === choice) {
                user.balance += robuxAmount * 2;
                await User.updateOne({ robloxUsername: robloxUsername }, { balance: user.balance });
                socket.emit('coinflipWon', { robuxAmount: robuxAmount * 2 });
                console.log('Coinflip won.');
            } else {
                socket.emit('coinflipLost', { robuxAmount: robuxAmount });
                console.log('Coinflip lost.');
            }

            socket.emit('updateBalance', { balance: user.balance });
        } catch (error) {
            console.error('Join coinflip error:', error);
            socket.emit('joinCoinflipError', 'Failed to join coinflip.');
        }
    });

    socket.on('deposit', async ({ robuxAmount }) => {
        if (!socket.user) return socket.emit('depositError', 'Not logged in.');

        try {
            const robloxId = socket.user.robloxId;
            socket.user.balance += robuxAmount;

            await User.updateOne({ robloxUsername: socket.user.robloxUsername }, { balance: socket.user.balance });
            socket.emit('depositSuccess', { message: 'Deposit successful!' });
            socket.emit('updateBalance', { balance: socket.user.balance });
        } catch (error) {
            console.error('Deposit error:', error);
            socket.emit('depositError', 'Failed to deposit Robux.');
        }
    });

    socket.on('withdraw', async ({ robuxAmount }) => {
        if (!socket.user) return socket.emit('withdrawError', 'Not logged in.');

        try {
            if (socket.user.balance < robuxAmount) {
                return socket.emit('withdrawError', 'Insufficient balance.');
            }
            socket.user.balance -= robuxAmount;
            await User.updateOne({ robloxUsername: socket.user.robloxUsername }, { balance: socket.user.balance });

            socket.emit('withdrawSuccess', { message: 'Withdrawal successful!' });
            socket.emit('updateBalance', { balance: socket.user.balance });
        } catch (error) {
            console.error('Withdraw error:', error);
            socket.emit('withdrawError', 'Failed to withdraw Robux.');
        }
    });
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
