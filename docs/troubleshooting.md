# Troubleshooting

Almost every problem is one of three things: the phone can't reach the PC, the browser is blocking something, or the text was read wrong. Find the heading that matches what you see.

## The phone says it can't reach your computer

The phone shows *"Check CopyCam is still running on your computer and that both are on the same Wi-Fi."* Work down this list and stop at the first fix that works.

1. **Is CopyCam still running?** The terminal window it started in has to stay open. If you closed it, start it again.
2. **Same network?** The phone must be on the same Wi-Fi as the PC. Mobile data doesn't count, and neither does a guest network. A PC on Ethernet works if its router also serves the Wi-Fi.
3. **Windows firewall.** The first time, Windows asks whether to let Node.js talk on your network. Choose **Private networks**. If you clicked Cancel, open Windows Security, then Firewall & network protection, then *Allow an app through firewall*, and tick **Private** for *Node.js JavaScript Runtime*. On a Mac, if it asks whether `node` may accept incoming connections, choose Allow.
4. **Windows thinks your network is Public.** Public networks block incoming connections. In Settings, open Network & internet, then Wi-Fi (or Ethernet), choose your network, and set the network profile type to **Private**.
5. **Router isolation.** Some routers stop Wi-Fi devices from seeing each other. The setting is often called *AP isolation* or *client isolation*, and it is on by default for guest networks.
6. **A VPN** on the phone or the PC can send local traffic the wrong way. Pause it and try again.
7. **The PC's address changed.** Home routers hand out addresses that can change. Rescan the QR code and it re-links. To stop it happening, give the PC a fixed address (a "DHCP reservation") in your router.
8. **Wrong network picked.** If the PC is on several networks, the terminal prints *"multiple networks detected, using 192.168.x.x"*. If that isn't your Wi-Fi's address, start CopyCam with `CC_IP` set to the right one:
   - Mac and Linux: `CC_IP=192.168.1.20 npx copycam`
   - Windows PowerShell: `$env:CC_IP="192.168.1.20"; npx copycam`

**To tell a network problem from a pairing problem:** the terminal prints a line starting *Browser app:* with an `https://` address. Type that address into the phone's browser. If a page loads, the network is fine and you only need to rescan the QR code. If nothing loads, it's one of the steps above.

## "This connection is not private"

The first time the browser app opens, the phone warns that the connection isn't private. This is expected. CopyCam makes its own security certificate, because a certificate from a public authority can't be issued for an address on your home network. Tap **Show Details** (iPhone) or **Advanced** (Android), then **Visit This Website** or **Proceed**.

What this does and doesn't mean is spelled out in [SECURITY.md](../SECURITY.md): everything you send is encrypted with a key that only travels in the QR code, but on a network where someone is actively tampering with traffic, the page itself could be swapped. Use CopyCam on Wi-Fi you trust, such as your own home network, and not on a café or airport network.

## The camera doesn't open

- The address in the phone's browser must start with **https://**. The camera is blocked on plain `http://` pages. Use the link from the QR code.
- If you tapped *Don't Allow* earlier, the browser won't ask again. On iPhone, tap the **aA** button in the address bar, then Website Settings, then Camera, then Allow. On Android Chrome, tap the icon at the left of the address bar, then Permissions. (Menu names change a little between versions.)
- Another app may be using the camera. Close it and reload the page.

## "Your computer no longer recognises this phone"

The pairing key changed on the PC, either because you ran CopyCam with `--reset` or because the `.copycam` folder was deleted. Scan the QR code on the PC's screen again to pair. That clears the photo you were looking at, so retake it afterwards.

## Nothing lands on the clipboard

Look at the terminal. When the phone sends something, it prints *✓ Copied 24 chars to clipboard*.

- **The line appears:** the text is on the clipboard. If pasting still gives something old, a clipboard manager or a remote-desktop session is in the way.
- **No line appears:** the phone didn't reach the PC. Go to the first section.
- **On Linux,** a desktop session (X11 or Wayland) is required. A PC with no desktop has no clipboard to write to.

## It won't start

- **`Error: listen EADDRINUSE`:** something is already using port 8787 or 8788, most often another copy of CopyCam. Close it, or choose another port. CopyCam uses that port and the next one, and the QR code carries it, so rescan afterwards.
  - Mac and Linux: `PORT=9000 npx copycam`
  - Windows PowerShell: `$env:PORT=9000; npx copycam`
- **`No LAN network interface found`:** connect the PC to Wi-Fi or Ethernet first.
- **`dist/mobile.html not found`:** you are running from a git checkout. Use `npm start`, which builds first.
- **Errors about syntax or modules:** CopyCam needs Node 20.19 or newer. Check with `node --version`.

## The first scan is slow, or wants the internet

The default reading model comes inside the npm package, so a first scan needs no network. Two cases download a file once and keep it:

- Running from a git checkout without `npm run models`: the first scan downloads the default model (about 31 MB).
- Picking a script other than the default in the phone's language button: that script's model downloads the first time you use it.

If a model can't load, for example because the PC is offline when a new script is first picked, the scan falls back to a simpler reader (tesseract.js). It reads English and fetches its language data once.

## The text came out wrong

No reader is perfect, and the [README](../README.md) lists what it is weakest at. These help:

- Fill the frame with the text, hold the phone still, and use good light. Small or glossy text reads worst.
- Choose the right script in the language button. The default covers Latin scripts and Chinese, Japanese and Korean. Cyrillic, Greek, Arabic and the rest need their own pick.
- Look-alike characters (`0` and `O`, `1` and `l`, `5` and `S`) are underlined in the review. Check them before you send anything that has to be exact, such as a password.
- Tap **Edit** to correct a character before sending.

## Where CopyCam keeps things

- `.copycam` in your user folder: the pairing key (`key.json`) and the certificate (`tls.json`). Delete the folder and every phone has to pair again.
- `.cache/ppu-paddle-ocr` in your user folder: downloaded reading models. Safe to delete.
- To pair with a fresh key and drop all phones: `npx copycam --reset`.

Nothing else is stored. Your photos and the text you send go only from your phone to your PC, never anywhere else.

## Still stuck?

Open an issue at <https://github.com/copycam/copycam/issues> and say which operating system you use, what `node --version` prints, and what the terminal showed. **Don't paste the pairing link or QR code**: the part after `#k=` is your key. Delete it from anything you share.
