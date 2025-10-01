const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files from parent directory
app.use(express.static(path.join(__dirname, '..')));

// Serve landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'LandingPage.html'));
});

// MongoDB config
const MONGO_URI = 'mongodb+srv://Admin:Aditi1719@cluster0.kvwvrxf.mongodb.net/?retryWrites=true&w=majority';
const dbName = 'onlineexam';
let db;

// Connect to MongoDB Atlas
async function connectToMongo() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(dbName);
    console.log(`Connected to MongoDB Atlas. Using database: ${dbName}`);
  } catch (err) {
    console.error('Failed to connect to MongoDB Atlas', err);
    process.exit(1);
  }
}

// User registration route
app.post('/register', async (req, res) => {
  const { fullname, email, dob, contact, gender, school } = req.body;
  if (!fullname || !email || !dob || !contact || !gender || !school) {
    return res.status(400).json({ message: 'All fields are required.' });
  }
  try {
    const registrations = db.collection('registrations');
    const existingUser = await registrations.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: 'Email already registered.' });
    }
    const newUser = { fullname, email, dob, contact, gender, school, registeredAt: new Date() };
    const result = await registrations.insertOne(newUser);
    res.status(201).json({ message: 'Registration successful!', id: result.insertedId, email: newUser.email });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Test results submission
app.post('/api/test-results', async (req, res) => {
  const testResults = req.body;
  if (!testResults || !testResults.registrationId) {
    return res.status(400).json({ message: 'Invalid test results data.' });
  }
  try {
    const testResultsCollection = db.collection('testresults');
    const result = await testResultsCollection.insertOne({
      ...testResults,
      submittedAt: new Date(),
    });
    if (result.acknowledged) {
      res.status(201).json({ message: 'Test results submitted successfully!', id: result.insertedId });
    } else {
      res.status(500).json({ message: 'Failed to save test results to database.' });
    }
  } catch (err) {
    console.error('Test results submission error:', err);
    res.status(500).json({ message: `Internal server error: ${err.message}` });
  }
});

// Admin dashboard
app.get('/api/admin/dashboard', async (req, res) => {
  try {
    const registrations = db.collection('registrations');
    const testResults = db.collection('testresults');
    const allUsers = await registrations.find({}).toArray();
    const allTestResults = await testResults.find({}).toArray();

    const dashboardData = allUsers.map(user => {
      const userResults = allTestResults.filter(r => r.candidateEmail === user.email);
      const latestResult = userResults.length > 0 ? userResults[userResults.length - 1] : null;

      return {
        name: user.fullname,
        email: user.email,
        finalScore: latestResult?.totalScore || "N/A",
        correctQuestions: latestResult?.correctAnswers || 0,
        incorrectQuestions: latestResult?.wrongAnswers || 0,
        unsolvedQuestions: latestResult?.unsolvedQuestions || 0,
      };
    });

    res.status(200).json(dashboardData);
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ message: 'Failed to fetch dashboard data.' });
  }
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const adminCollection = db.collection('admin');
    const adminUser = await adminCollection.findOne({ email });
    if (adminUser && adminUser.password === password) {
      res.status(200).json({ message: 'Login successful' });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// User results
app.get('/api/user/results', async (req, res) => {
  const userEmail = req.query.email;
  if (!userEmail) return res.status(400).json({ message: 'Email query parameter is required.' });
  try {
    const testResultsCollection = db.collection('testresults');
    const userResults = await testResultsCollection.findOne({ candidateEmail: userEmail });
    if (!userResults) return res.status(404).json({ message: 'No test results found for this user.' });
    res.status(200).json(userResults);
  } catch (err) {
    console.error('User results retrieval error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Start server after Mongo connection is ready
async function startServer() {
  await connectToMongo();
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
  });
}

startServer();
