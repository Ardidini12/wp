// Load environment variables from .env file
require('dotenv').config();

var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require('express-session');

// Import the WhatsApp client to ensure it initializes
const { client } = require('./utils/whatsappClient');
// Import the bulk sender to start the message queue
const { startProcessingQueue } = require('./utils/bulkSender');
// Import sales API for auto sync
const salesApi = require('./utils/salesApi');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var sessionRouter = require('./routes/session');
var workingHoursRouter = require('./routes/workingHours');
var salesRouter = require('./routes/sales');
var salesSenderRouter = require('./routes/salesSender');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Session setup
app.use(session({
  secret: 'your-secret-key', // Replace with a strong secret
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
}));

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/api/session', sessionRouter);
app.use('/', workingHoursRouter);
app.use('/', salesRouter);
app.use('/', salesSenderRouter);

// Start the message queue after WhatsApp client is initialized
client.on('ready', async () => {
  console.log('WhatsApp client is ready, starting message queue...');
  try {
    // Start processing messages
    const started = await startProcessingQueue();
    console.log('Message queue processing started:', started);
    
    // Check for pending messages
    const { getScheduledMessagesStats } = require('./utils/bulkSender');
    const stats = await getScheduledMessagesStats();
    if (stats.pending > 0) {
      console.log(`Found ${stats.pending} pending messages that will be processed`);
    } else {
      console.log('No pending messages found');
    }
    
    // Initialize sales API sync immediately with a more frequent schedule for real-time updates
    console.log('Initializing sales data auto sync...');
    // Run every 2 minutes for near real-time updates
    salesApi.startAutoSync('*/2 * * * *');

    // Initialize sales sender processing
    console.log('Initializing sales sender message processing...');
    const salesSender = require('./utils/salesSender');
    await salesSender.initializeSettings();
    salesSender.startProcessingQueue();
  } catch (error) {
    console.error('Error starting message queue:', error);
  }
});

// catch 404 and forward to error handler
app.use((req, res, next) => {
  const err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
