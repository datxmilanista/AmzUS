const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const puppeteer = require('puppeteer');
const { QMainWindow, QWidget, QLabel, QLineEdit, QPushButton, QTextEdit, 
        QCheckBox, QBoxLayout, QApplication, QIcon } = require("@nodegui/nodegui");

// Global values
global.data = {};

// Load parent account config with error handling
try {
    const dataFile = JSON.parse(fs.readFileSync(path.join(__dirname, "src", "data", 'data.json'), 'utf8'));
    global.data.parentAcc = dataFile.settings || { geminiKey: "" };
} catch (error) {
    console.log("Warning: data.json not found, using default settings");
    global.data.parentAcc = { geminiKey: "" };
}

global.data.settings = {
  debug: false,
  showBrowser: true,
  checkAfter: 60000 // Default 60 seconds in milliseconds
};
global.data.browser = {};

// Initialize application
const app = QApplication.instance();
app.setQuitOnLastWindowClosed(true);
const win = new QMainWindow();
win.setWindowTitle("AmzUS Application");
win.resize(900, 700);

// Set application icon
const appIcon = new QIcon(path.join(__dirname, "src", "assets", "app-icon.png"));
win.setWindowIcon(appIcon);

// Create main widget with black background
const centralWidget = new QWidget();

require(path.join(__dirname, "src", "index.js"))(centralWidget);

// Set the central widget and show
win.setCentralWidget(centralWidget);
win.show();

// Start the event loop
global.win = win;
// app.exec();