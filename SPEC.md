# QuickKee

A browser extension for Chrome and Firefox that can open and manage KeePass databases.

## Features
- KeePass entry browser, can view entries and groups in both sidebar and extension icon popup
- Extension icon popup on a website with no entry prompts for creating an entry with a auto generated password
- Autofill popups for login forms, recognizing user/email and password fields.
- Browser sidebar to browse the database fully
    - Sidebar also can edit entries and groups
- Both extension icon popup and sidebar also show additional fields on the entry and allow copying it
- Database can be opened from cloud storage providers Dropbox and Google Drive
    - Opening from cloud will be cached locally in case of no network connection for next open
    - Also syncs to the same cloud upon save
    - Syncs and opening from cloud reconciles possible conflicts that can arise from saves from other devices (compares against local cache when opening)
- Extension settings option to auto-close database after X hours (selected from a list)
- Copy buttons for fields with auto-clear the clipboard
- Security feature to show a warning when viewing a site with bad certificate
- Extension icon changes color depending on website (has saved passwords or not)
- Dark and light themes
- Search bar for entries (by name, URL)
- Expired entries clearly marked
- Quick browse/search/view entry from extension icon popup
- Extension settings for default auto generated password

## Extension icon popup
On a website with a password already saved (by URL field)
- Icon color is changed and a number shows for how many entries
- Popup shows, for each entry:
    - username, with buttons to copy username and password
    - Collapsible to open and see all fields (with a copy button)
    - Button to autofill entry in page
    - Expired entry shows clearly it is expired
- Above entries, show quick browse/search

On a website without a password:
- shows quick browse/search
- Below it a form to create and save an entry
    - Password already default auto generated
    - URL autofilled to current website