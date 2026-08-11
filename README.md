# BrowseBuddy

A powerful browser extension for managing browsing history with privacy protection. All data stays local on your device - no cloud uploads, no data sharing. [home page](https://leapx-ai.github.io/BrowseBuddy)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)

## Features

### 🔍 History Management

- **Smart Search**: Search by title, URL, or date range, with `site:`/`before:`/`after:` syntax
- **Multiple Views**: List view, date-grouped view, domain-grouped view
- **Calendar View**: Month heatmap with quick date jumping to that day's history
- **Restore tabs**: Reopen recently closed tabs or windows

### 🗑️ Bulk Delete

- Delete by date range
- Delete by domain
- Delete by keyword
- Preview before delete
- Delete confirmation

### 📊 Statistics & Analysis

- Visit frequency trends
- Top visited sites
- Time distribution (24-hour heatmap)
- **Dwell time stats**: Most time spent per site
- Daily/weekly/monthly statistics
- Export to CSV and HTML

### 🛡️ Privacy Protection

- Domain blacklist (auto-matches all subdomains)
- Real-time protection (auto-delete blacklisted sites)
- **Session incognito mode**: scrubs all history while active, with a 🕶️ toolbar indicator
- All data stored locally

### ⚙️ Settings & Backup

- Language selection (English/中文)
- Dark/Light theme
- Data backup and restore (with optional scheduled auto-backup)
- Storage usage monitoring

## Installation

### From Source

1. Clone this repository:

```bash
git clone https://github.com/yourusername/browsebuddy.git
cd browsebuddy
```

2. Install dependencies:

```bash
npm install
```

3. Build the extension:

```bash
npm run build
```

4. Load the extension in your browser:
   - **Chrome/Edge**: Go to `chrome://extensions/`, enable Developer mode, click "Load unpacked", select the `dist` folder
   - **Firefox**: Go to `about:debugging`, click "This Firefox", click "Load Temporary Add-on", select any file in the `dist` folder

### Development

Run in development mode with hot reload:

```bash
npm run watch
```

## Usage

1. Click the BrowseBuddy icon in your browser toolbar
2. Use the navigation tabs to switch between features:
   - **Delete**: Remove history by date, domain, or keyword
   - **View**: Browse and search your history
   - **Statistics**: View charts and analytics
   - **Privacy**: Manage blacklist and privacy settings
3. Access detailed settings via the gear icon

## Privacy Policy

**BrowseBuddy takes your privacy seriously:**

- All history data is processed and stored locally on your device
- No data is uploaded to any external servers
- No analytics or tracking
- No third-party data sharing
- Open source code for transparency

## Browser Support

- Chrome 88+
- Edge 88+
- Firefox 109+

## Technology Stack

- TypeScript
- React
- Webpack
- Chrome Extension Manifest V3

## Project Structure

```
browsebuddy/
├── src/
│   ├── background/      # Service worker
│   ├── popup/           # Popup UI components
│   ├── options/         # Options page
│   ├── types/           # TypeScript types
│   └── utils/           # Utility functions
├── public/              # Static assets
├── _locales/            # i18n files
└── dist/                # Build output
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Icons powered by [Feather Icons](https://feathericons.com/)
- Built with [React](https://reactjs.org/)

# BrowseBuddy
