# Privacy policy

_Last updated: 23 October 2026_

**The short version.** CopyCam has no accounts, no tracking and no ads. Your photos and the text you send go from your phone to your own computer, encrypted end to end. In the browser version they pass through copycam.app on the way, sealed so that it can't read them, and it keeps nothing. This website counts visits to its information pages with Cloudflare's analytics and keeps nothing else about you.

## Who I am

CopyCam is made and run by me, Safi Hazzan, in Israel. You can reach me at [hello@copycam.app](mailto:hello@copycam.app). Where this policy describes personal data that I handle (the website, relay and email sections below), I am the one responsible for it. I never receive your photos or the text you send.

This policy is written to meet Israel's Protection of Privacy Law, 5741-1981, as amended, and, where they apply to you, the EU and UK General Data Protection Regulations (GDPR).

**You never have to give me anything.** No law requires you to give me any personal data. You can use CopyCam and this website without telling me who you are, and writing to me is your choice.

## The browser version (copycam.app/app)

This covers CopyCam used with nothing installed: the page you open on your computer (copycam.app/app) and the page your phone opens when it scans that page's code (copycam.app/p).

**The text is read on your computer.** Your phone sends each photo to the copycam.app tab on your computer, and that tab reads the text itself, in your browser. The text you pick goes back the same way and onto your computer's clipboard. No photo and no text is read, kept or seen anywhere else.

**How they reach each other: the relay.** Your phone and that tab can't connect to each other directly, so both connect to a small relay at copycam.app, which passes messages between them. Every message is encrypted end to end with a key that only travels inside the QR code on your screen, so the relay, and I, can't read any of them. The relay keeps nothing: it holds a message only for the moment it takes to pass it on, writes nothing to storage, and logs nothing. What it does see, because it has to, is that a phone and a computer are connected to the same "room" (a random address made by your computer's browser), when they send messages, and how large those are. Like any website, it also sees the IP address each connection comes from. The relay runs on Cloudflare's network (see "Who else handles data").

**What stays in your browsers.** On your computer, the copycam.app page keeps its pairing key and its room address in the browser's storage, so your phone stays linked next time, and keeps the text reader's files (about 44 MB) in the browser's cache so they download only once. The text you receive is listed on the page only until you close the tab or clear the list; it is never saved. On your phone, the browser keeps the pairing key, the room address and your chosen language. Clearing the site's data for copycam.app in either browser forgets all of it; "Unlink phones" on the computer page makes a new key, so phones linked before can no longer send anything.

**Notifications, if you turn them on.** The computer page can show a notification when text arrives while you're in another window. It says only that text is ready; it never shows the text.

**No analytics there.** The two app pages carry no analytics and load nothing from any other website.

## The desktop companion (npx copycam)

This covers the `copycam` program you can run on your computer instead, and the CopyCam page it serves to your phone's browser.

**Your photos and text stay on your devices.** When you scan, the phone sends the photo to your computer over your own Wi-Fi, encrypted with a key that only travels inside the QR code on your screen. Your computer reads the text, puts it on its clipboard, and does not save the photo. None of it passes through me or any server of mine. I can't see it, and I have no way to.

**What the companion keeps on your computer.** A folder called `.copycam` in your user folder holds the pairing key (`key.json`) and the security certificate CopyCam makes for itself (`tls.json`). If the backup reader is ever needed, its English language data is kept there too. Downloaded text-reading models are kept in `.cache/ppu-paddle-ocr`. On your phone, the browser remembers the pairing key and your chosen language for the CopyCam page. Deleting these folders, or clearing the page's data in your phone's browser, forgets all of it.

**What CopyCam never does.** In either version: no accounts, no analytics in the app, no crash reports and no advertising. The text you send is never written to a log: the terminal only shows how many characters were copied.

**The few connections it makes.** While you use it, none. A few things do reach out, and none of them carries a photo or any text:

- Installing it with `npx copycam` downloads it from the npm registry, which is run by GitHub.
- On 64-bit Linux, installing also lets one of its components (ONNX Runtime) download an optional graphics-card add-on (about 270 MB) from Microsoft's NuGet service (`api.nuget.org`). CopyCam doesn't use it. To prevent the download, set the environment variable `ONNXRUNTIME_NODE_INSTALL=skip` before installing. Windows, macOS and other Linux machines don't make this download.
- The default text-reading model ships inside the package. If you pick a different script (for example Cyrillic or Arabic), that model is downloaded once from GitHub (`raw.githubusercontent.com` and `media.githubusercontent.com`) and kept.
- If the main reader can't start, the backup reader fetches its English language data once from jsDelivr (`cdn.jsdelivr.net`).

Those services see your IP address and which file you asked for, and they have their own privacy policies. CopyCam is open source, so you can check all of this in [the code](https://github.com/copycam/copycam), and [SECURITY.md](https://github.com/copycam/copycam/blob/main/SECURITY.md) explains exactly how the encryption works and what it doesn't cover.

## This website (copycam.app)

**Hosting.** The site and the relay are hosted on Cloudflare Workers. As the host, Cloudflare processes technical details of every request (such as your IP address, browser type and the page you asked for) to deliver and protect the site. [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/) applies to that.

**Analytics.** On the information pages (this one, the home page, and the legal pages), but not on the two app pages, I use Cloudflare Web Analytics to see how the site is used. It reports to me totals and breakdowns: pages viewed, where visitors came from (the referring site), country, device type, browser, operating system, and how fast pages load. Cloudflare states that it "does not track individual end users across our customers' Internet properties". I use no advertising trackers, no marketing tools and no social-media widgets. The site sets no cookies of its own and shows no cookie banner. [Cloudflare's documentation](https://developers.cloudflare.com/web-analytics/) describes how its analytics works.

**Why.** To run and secure a small website and to understand, in broad terms, whether it is useful. Under the GDPR this is my legitimate interest (Article 6(1)(f)). I don't use the information to identify or follow individual visitors.

**There is nothing to sign up for.** The site has no accounts, forms or comments.

**Links with a source.** Some links I share, for example from CopyCam's social-media profiles, go to an address like copycam.app/tiktok, which shows the home page. That only tells my analytics totals how many visits came from there.

## Email and GitHub

**Email.** Mail to hello@copycam.app arrives through Cloudflare Email Routing and is forwarded to my personal mailbox. I use your address and message only to reply, and I keep a conversation for as long as it is useful. Ask me and I'll delete it.

**Phone.** The accessibility statement lists a phone number. If you call or message me on it, I use your number only to reply, and I delete it on request.

**GitHub.** The code and its issue tracker live at [github.com/copycam](https://github.com/copycam). Anything you post there is public and handled under [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Please don't paste a CopyCam pairing link in an issue: the part after `k=` is your key.

## Who else handles data, and where

Cloudflare (hosting, the relay, analytics and email routing), GitHub and its npm registry (code, issues, downloads), Microsoft's NuGet service (only the Linux add-on described above), and jsDelivr (only the backup reader's language data). They may process data in the United States and in other countries; their own policies describe the safeguards they use.

I am in Israel, which both the European Commission and the UK recognise as providing an adequate level of protection for personal data. So data you send me from the EU or the UK needs no extra transfer arrangement.

## How long I keep things

Analytics are kept by Cloudflare for the period it sets for its service, and I only ever see the totals. The relay keeps nothing. Email is kept as described above. Your photos and text are never mine to keep: I never receive them.

## Your rights

Under Israeli law you can ask to see the personal data I hold about you, and ask me to correct or delete it. If the GDPR or the UK GDPR applies to you, you can also object to or restrict how it is used and receive a copy of it. Because I hold almost nothing about anyone, requests are usually quick: email me.

If you're unhappy with how I've handled your data, you can complain to Israel's [Privacy Protection Authority](https://www.gov.il/en/departments/the_privacy_protection_authority), or to the data-protection authority where you live.

## Children

CopyCam is not aimed at children, and it collects nothing from anyone, which includes children.

## Changes

If I change this policy I'll update the date at the top. The full history of every change is public in [the repository](https://github.com/copycam/copycam/commits/main/docs/legal/privacy.md).
