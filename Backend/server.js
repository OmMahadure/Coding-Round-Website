const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');

const app = express();
const port = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the parent directory (Coding-Round-Website)
app.use(express.static(path.join(__dirname, '..')));

// Root route to serve LandingPage.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'LandingPage.html'));
});

// MongoDB Atlas connection URI
const MONGO_URI = 'mongodb+srv://Admin:Aditi1719@cluster0.kvwvrxf.mongodb.net/?retryWrites=true&w=majority';
const dbName = 'onlineexam';
const registrationCollectionName = 'registrations';
const testResultsCollectionName = 'testresults';
const adminCollectionName = 'admin';
let db;

// Connect to MongoDB
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

// Routes
// 1. User Registration Route
app.post('/register', async (req, res) => {
  console.log('Received registration request');
  const { fullname, email, dob, contact, gender, school } = req.body;
  if (!fullname || !email || !dob || !contact || !gender || !school) {
    console.error('Registration request failed: Missing required fields');
    return res.status(400).json({ message: 'All fields are required.' });
  }
  try {
    const registrations = db.collection(registrationCollectionName);
    const existingUser = await registrations.findOne({ email });
    if (existingUser) {
      console.warn(`Registration attempt for existing user: ${email}`);
      return res.status(409).json({ message: 'Email already registered.' });
    }
    const newUser = { fullname, email, dob, contact, gender, school, registeredAt: new Date() };
    const result = await registrations.insertOne(newUser);
    console.log(`New user registered with ID: ${result.insertedId}`);
    res.status(201).json({ message: 'Registration successful!', id: result.insertedId, email: newUser.email });
  } catch (err) {
    console.error('Error during registration:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// 2. Test Results Submission Route
app.post('/api/test-results', async (req, res) => {
  console.log('Received test results submission request');
  const testResults = req.body;
  console.log('Received data:', JSON.stringify(testResults, null, 2));

  if (!testResults || !testResults.registrationId) {
    console.error('Test results submission failed: Missing registrationId in data');
    return res.status(400).json({ message: 'Invalid test results data.' });
  }

  try {
    const testResultsCollection = db.collection(testResultsCollectionName);
    const result = await testResultsCollection.insertOne({
      ...testResults,
      submittedAt: new Date(),
    });

    if (result && result.acknowledged) {
      console.log(`Test results saved to database with ID: ${result.insertedId}`);
      res.status(201).json({ message: 'Test results submitted successfully!', id: result.insertedId });
    } else {
      console.error(`Test results NOT SAVED. Database response: ${JSON.stringify(result)}`);
      res.status(500).json({ message: 'Failed to save test results to database.' });
    }
  } catch (err) {
    console.error('Error submitting test results:', err);
    console.error('MongoDB insert error details:', err.message);
    res.status(500).json({ message: `Internal server error: ${err.message}` });
  }
});

// 3. Admin Dashboard API Route
app.get('/api/admin/dashboard', async (req, res) => {
  console.log('Received request for admin dashboard data');
  try {
    const registrations = db.collection(registrationCollectionName);
    const testResults = db.collection(testResultsCollectionName);

    const allUsers = await registrations.find({}).toArray();
    console.log(`Fetched ${allUsers.length} user registrations.`);

    const allTestResults = await testResults.find({}).toArray();
    console.log(`Fetched ${allTestResults.length} test results.`);

    const dashboardData = allUsers.map(user => {
      const userResults = allTestResults.filter(r => r.candidateEmail === user.email);
      const results = userResults.length > 0 ? userResults[userResults.length - 1] : null;

      let correct = 0;
      let incorrect = 0;
      let unsolved = 0;
      let finalScore = "N/A";

      if (results) {
        correct = results.correctAnswers || 0;
        incorrect = results.wrongAnswers || 0;
        unsolved = results.unsolvedQuestions || 0;
        finalScore = results.totalScore || "N/A";

        console.log(`User ${user.email} - Found ${userResults.length} test results, using latest:`, {
          correctAnswers: results.correctAnswers,
          wrongAnswers: results.wrongAnswers,
          unsolvedQuestions: results.unsolvedQuestions,
          totalScore: results.totalScore
        });
      } else {
        console.log(`User ${user.email} - No test results found`);
      }

      return {
        name: user.fullname,
        email: user.email,
        finalScore: finalScore,
        correctQuestions: correct,
        incorrectQuestions: incorrect,
        unsolvedQuestions: unsolved,
      };
    });

    console.log('Successfully processed dashboard data.');
    res.status(200).json(dashboardData);

  } catch (err) {
    console.error('Error fetching dashboard data:', err);
    res.status(500).json({ message: 'Failed to fetch dashboard data.' });
  }
});

// 4. Admin Login Route
app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;
  console.log(`Attempting admin login for: ${email}`);

  try {
    const adminCollection = db.collection(adminCollectionName);
    const adminUser = await adminCollection.findOne({ email });

    if (adminUser && adminUser.password === password) {
      console.log(`Admin user ${email} logged in successfully.`);
      res.status(200).json({ message: 'Login successful' });
    } else {
      console.log(`Failed login attempt for: ${email}`);
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (err) {
    console.error('Error during admin login:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Endpoint to get a single user's test results
app.get('/api/user/results', async (req, res) => {
  const userEmail = req.query.email;
  console.log(`Received request for user results for: ${userEmail}`);

  if (!userEmail) {
    return res.status(400).json({ message: 'Email query parameter is required.' });
  }

  try {
    const testResultsCollection = db.collection(testResultsCollectionName);
    const userResults = await testResultsCollection.findOne({ candidateEmail: userEmail });

    if (!userResults) {
      return res.status(404).json({ message: 'No test results found for this user.' });
    }

    res.status(200).json(userResults);
  } catch (err) {
    console.error('Error fetching user results:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Debug endpoint to see all test results
app.get('/api/debug/test-results', async (req, res) => {
  try {
    const testResultsCollection = db.collection(testResultsCollectionName);
    const allResults = await testResultsCollection.find({}).toArray();
    console.log('All test results in database:', JSON.stringify(allResults, null, 2));
    res.status(200).json(allResults);
  } catch (err) {
    console.error('Error fetching all test results:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Debug endpoint to see email matching
app.get('/api/debug/email-matching', async (req, res) => {
  try {
    const registrations = db.collection(registrationCollectionName);
    const testResults = db.collection(testResultsCollectionName);

    const allUsers = await registrations.find({}).toArray();
    const allTestResults = await testResults.find({}).toArray();

    const emailComparison = allUsers.map(user => {
      const testResult = allTestResults.find(r => r.candidateEmail === user.email);
      return {
        registrationEmail: user.email,
        hasTestResult: !!testResult,
        testResultEmail: testResult ? testResult.candidateEmail : null,
        exactMatch: testResult ? (user.email === testResult.candidateEmail) : false
      };
    });

    res.status(200).json({
      totalRegistrations: allUsers.length,
      totalTestResults: allTestResults.length,
      emailComparisons: emailComparison,
      testResultEmails: allTestResults.map(r => r.candidateEmail)
    });
  } catch (err) {
    console.error('Error in email matching debug:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Start the server
async function startServer() {
  await connectToMongo();

  // Uncomment ONLY ONCE to setup the admin user. Then comment out again.
  // await setupAdminUser();

  app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
}

// Setup admin user function - run once
async function setupAdminUser() {
  const adminCollection = db.collection(adminCollectionName);
  const adminCredentials = {
    email: '9teeninitative@gmail.com',
    password: 'Admin@098',
    createdAt: new Date()
  };

  const existingAdmin = await adminCollection.findOne({ email: adminCredentials.email });
  if (!existingAdmin) {
    await adminCollection.insertOne(adminCredentials);
    console.log(`Admin user ${adminCredentials.email} set up successfully.`);
  } else {
    console.log(`Admin user ${adminCredentials.email} already exists.`);
  }
}

startServer();
