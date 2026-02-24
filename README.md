# YCopy (Local Clip Vault)

A local-first PWA clipboard that saves shared text, links, and files into IndexedDB. Install it on Android and use the system share sheet to capture anything offline.

## Features

- Share Target PWA (Android share sheet)
- Offline-first with service worker caching
- Saves text, links, and files to IndexedDB
- Pin important clips to keep them at the top
- Fuzzy search across saved text, links, and file names
- Image previews and file download links
- One-tap copy for saved text and links

## Usage

1. Open the app: https://utkarshusername.github.io/YCopy/
2. Install the PWA from the browser menu.
3. Share content from any Android app and select **YCopy**.
4. Open YCopy to view, copy, or delete your clips.

## Development

This is a static PWA. You can serve it with any static server.

```bash
# Example
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## GitHub Pages

The app is configured for GitHub Pages using relative paths and a manifest scope.

To publish updates:

```bash
git push -u origin main
```

Then in GitHub Pages settings, use:

- Branch: `main`
- Folder: `/ (root)`

## Notes

- The Share Target API requires HTTPS and a PWA install.
- Some browsers may limit share targets or background share handling.
