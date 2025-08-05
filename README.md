# AmzUS - CHK Card

**A desktop application for managing Amazon US accounts with automated login and business account setup capabilities.**

## Features

- 🔐 Automated Amazon account login
- 🏢 Business account registration and setup
- 🌐 Proxy support for multiple concurrent sessions
- 📊 Real-time logging and monitoring
- 💳 Card information management
- 🔄 Batch processing with configurable concurrency

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn package manager

## Installation

1. Clone the repository:
```bash
git clone https://github.com/datxmilanista/AmzUS
cd AmzUS
```

2. Install dependencies:
```bash
npm install
```

## Usage

1. Start the application:
```bash
npm start
```

2. The GUI will open with the following sections:
   - Account management
   - Proxy configuration
   - Card information tracking
   - Real-time logs

3. Configure your settings and start processing accounts

## Project Structure

```
AmzUS/
├── main.js              # Application entry point
├── src/
│   ├── index.js         # Main GUI setup
│   ├── api/             # API integrations
│   ├── util/            # Utility functions
│   ├── assets/          # Application assets
│   └── data/            # Data storage
└── output/              # Processing results
```

## Configuration

- Edit account credentials in the data files
- Configure proxy settings through the GUI
- Adjust browser and processing settings as needed

## Output

Results are automatically saved in the `output/` directory organized by date:
- `live.txt` - Successfully processed accounts
- `die.txt` - Failed accounts
- `remaining_cards.txt` - Remaining cards to process

## Notes

- Supports headless and visible browser modes
- Built-in CAPTCHA handling
- Automatic cleanup on process termination
- Multi-threaded processing based on proxy count

## License

This project is for educational purposes only.




