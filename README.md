---
title: PW Downloader
emoji: 📥
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
---

# PW Lecture Downloader

A powerful, robust, and highly-automated system for detecting, bypassing protections, and downloading Physics Wallah (PW) lecture videos in original HD quality.

## Project Structure

This project consists of three main components:
1. **Chrome Extension**: Intercepts video network requests directly from the browser, extracts lecture names, and sends them to the downloader backend.
2. **Node.js Backend**: Handles the heavy lifting. Parses playlists, bypasses Cloudflare protections, decrypts AES-128 DRM encrypted chunks, downloads video segments in parallel, and perfectly merges them into an MP4 file.
3. **React Web App**: A beautiful frontend UI to manage downloads, select video qualities, and track download progress.

---

## 🚀 How It Works (Step-by-Step)

### 1. Detection (Chrome Extension)
- When you play a lecture on the PW website, the **Chrome Extension** (`background.js` and `content.js`) continuously monitors network requests.
- It specifically looks for Master Playlists (files ending in `.m3u8` or `.mpd`) from known video servers (e.g., `pw.live`, `cloudfront.net`, `penpencil.co`, `testwave.cc`).
- Once a valid video URL is found, the extension grabs the current browser tab's title (stripping away unnecessary "Physics Wallah" branding) to auto-detect the **Lecture Title**.
- The extension badge turns red and notifies you that a video is ready to download.

### 2. URL Processing & Protection Bypass
When you attempt to fetch the video qualities, the URL is sent to the Node.js Backend (`/api/parse`), which applies several automated bypasses:
- **DRM Bypass**: If the video is a Widevine DASH (`.mpd`) stream, the backend automatically swaps the extension to `.m3u8` (HLS format), which forces the server to provide the non-DRM (or basic AES-128) version of the stream.
- **Cloudflare Proxy Bypass**: If the video is hidden behind a third-party Cloudflare proxy (like `proxy.pwthor.live` or `streamvideo.co.in`), the backend intelligently strips the proxy prefix out of the URL. It queries the raw AWS Cloudfront server directly, completely avoiding Cloudflare's Bot Protection `403 Forbidden` errors.

### 3. Downloading (Node.js Backend)
When you click **Download**, the backend initiates a high-speed parallel download process (`/api/download`):
- It fetches the exact media playlist for your chosen resolution (e.g., 1080p, 720p).
- **AES-128 Decryption**: If the HLS stream is encrypted, the backend forcefully resolves the AES decryption key from the CDN root directory. 
- It spawns **150 concurrent workers** to download the tiny `.ts` (or `.mp4`) video segments simultaneously, saving them in a temporary folder. Each segment is decrypted on-the-fly using Node's native `crypto` module.
- Progress updates are streamed back to your UI (Extension Popup or Web App) in real-time using **Server-Sent Events (SSE)**.

### 4. Merging (FFmpeg)
- Once all 500+ segments are successfully downloaded, the backend uses **FFmpeg** to merge them together.
- It uses a direct stream pipe (`-c copy`), which means the video is remuxed into an `.mp4` container **without re-encoding**. This guarantees **Zero Quality Loss** and takes only a few seconds.
- The final file is renamed to match the exact **Lecture Title** detected earlier.
- You can now save the `.mp4` file directly to your local computer!

---

## 🛠️ How to Install & Use

### Installing the Extension
1. Download the `extension.zip` file from this repository and extract it to a folder.
2. Open Google Chrome (or Edge/Brave) and go to `chrome://extensions/`.
3. Enable **Developer Mode** (toggle in the top right corner).
4. Click **"Load unpacked"** and select the folder where you extracted the extension.
5. Pin the **PW Lecture Downloader** extension to your toolbar.

### Downloading a Video
1. Go to the PW website and start playing the lecture you want to download.
2. Click on the extension icon in your toolbar. It will show the detected video URL and the auto-filled Lecture Title.
3. You have two options:
   - **Download in Popup**: Click "Fetch Quality Options", select your resolution, and click Download. Do not close the popup while it downloads!
   - **Download in Web App (Recommended)**: Click **"Open Web App ↗"** at the bottom of the popup. This will safely open the Downloader in a permanent browser tab, automatically carrying over your URL and Lecture Title so you can download in the background while switching tabs!

---

## Technical Features Overview
- **Real-time SSE Progress**: Live streaming of downloaded MBs, estimated size, and chunk counts.
- **Dynamic File Naming**: Automatically titles your `.mp4` file based on the lecture name.
- **Auto-Recovery**: If a chunk fails to download, the workers retry seamlessly.
- **Sequential DASH Brute-forcing**: For raw chunked `.mp4` links, the system auto-detects the sequence and brute-force downloads all available chunks until the stream terminates natively.
