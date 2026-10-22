# Privacy policy

_Last updated: 22 October 2026_

**The short version.** The CopyCam software has no accounts, no tracking and no ads. Your photos and the text you send go from your phone to your own computer, encrypted, and nowhere else. This website counts visits with Cloudflare's analytics and keeps nothing else about you.

## Who I am

CopyCam is made and run by me, Safi Hazzan, in Israel. You can reach me at [hello@copycam.app](mailto:hello@copycam.app). Where this policy describes personal data that I handle (the website and email sections below), I am the one responsible for it. For the CopyCam software itself I receive no personal data at all.

This policy is written to meet Israel's Protection of Privacy Law, 5741-1981, as amended, and, where they apply to you, the EU and UK General Data Protection Regulations (GDPR).

**You never have to give me anything.** No law requires you to give me any personal data. You can use CopyCam and this website without telling me who you are, and writing to me is your choice.

## The CopyCam software

This covers the `copycam` program you run on your computer and the CopyCam page it serves to your phone's browser.

**Your photos and text stay on your devices.** When you scan, the phone sends the photo to your computer over your own Wi-Fi, encrypted with a key that only travels inside the QR code on your screen. Your computer reads the text, puts it on its clipboard, and does not save the photo. None of it passes through me or any server of mine. I can't see it, and I have no way to.

**What CopyCam keeps on your computer.** A folder called `.copycam` in your user folder holds the pairing key (`key.json`) and the security certificate CopyCam makes for itself (`tls.json`). If the backup reader is ever needed, its English language data is kept there too. Downloaded text-reading models are kept in `.cache/ppu-paddle-ocr`. On your phone, the browser remembers the pairing key and your chosen language for the CopyCam page. Deleting these folders, or clearing the page's data in your phone's browser, forgets all of it.

**What CopyCam never does.** It has no accounts, no analytics, no crash reports and no advertising. The text you send is never written to a log: the terminal only shows how many characters were copied.

**The few connections it makes.** While you use it, none. A few things do reach out, and none of them carries a photo or any text:

- Installing it with `npx copycam` downloads it from the npm registry, which is run by GitHub.
- On 64-bit Linux, installing also lets one of its components (ONNX Runtime) download an optional graphics-card add-on from Microsoft's NuGet service (`api.nuget.org`). CopyCam doesn't use it. To prevent the download, set the environment variable `ONNXRUNTIME_NODE_INSTALL=skip` before installing. Windows, macOS and other Linux machines don't make this download.
- The default text-reading model ships inside the package. If you pick a different script (for example Cyrillic or Arabic), that model is downloaded once from GitHub (`raw.githubusercontent.com` and `media.githubusercontent.com`) and kept.
- If the main reader can't start, the backup reader fetches its English language data once from jsDelivr (`cdn.jsdelivr.net`).

Those services see your IP address and which file you asked for, and they have their own privacy policies. CopyCam is open source, so you can check all of this in [the code](https://github.com/copycam/copycam), and [SECURITY.md](https://github.com/copycam/copycam/blob/main/SECURITY.md) explains exactly how the encryption works and what it doesn't cover.

## This website (copycam.app)

**Hosting.** The site is hosted on Cloudflare Pages. As the host, Cloudflare processes technical details of every request (such as your IP address, browser type and the page you asked for) to deliver and protect the site. [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/) applies to that.

**Analytics.** I use Cloudflare Web Analytics to see how the site is used. It reports to me totals and breakdowns: pages viewed, where visitors came from (the referring site), country, device type, browser, operating system, and how fast pages load. Cloudflare states that it "does not track individual end users across our customers' Internet properties". I use no advertising trackers, no marketing tools and no social-media widgets. The site sets no cookies of its own and shows no cookie banner. [Cloudflare's documentation](https://developers.cloudflare.com/web-analytics/) describes how its analytics works.

**Why.** To run and secure a small website and to understand, in broad terms, whether it is useful. Under the GDPR this is my legitimate interest (Article 6(1)(f)). I don't use the information to identify or follow individual visitors.

**There is nothing to sign up for.** The site has no accounts, forms or comments.

## Email and GitHub

**Email.** Mail to hello@copycam.app arrives through Cloudflare Email Routing and is forwarded to my personal mailbox. I use your address and message only to reply, and I keep a conversation for as long as it is useful. Ask me and I'll delete it.

**Phone.** The accessibility statement lists a phone number. If you call or message me on it, I use your number only to reply, and I delete it on request.

**GitHub.** The code and its issue tracker live at [github.com/copycam](https://github.com/copycam). Anything you post there is public and handled under [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Please don't paste a CopyCam pairing link in an issue: the part after `#k=` is your key.

## Who else handles data, and where

Cloudflare (hosting, analytics and email routing), GitHub and its npm registry (code, issues, downloads), Microsoft's NuGet service (only the Linux add-on described above), and jsDelivr (only the backup reader's language data). They may process data in the United States and in other countries; their own policies describe the safeguards they use.

I am in Israel, which both the European Commission and the UK recognise as providing an adequate level of protection for personal data. So data you send me from the EU or the UK needs no extra transfer arrangement.

## How long I keep things

Analytics are kept by Cloudflare for the period it sets for its service, and I only ever see the totals. Email is kept as described above. The software keeps nothing of mine, because I never receive anything.

## Your rights

Under Israeli law you can ask to see the personal data I hold about you, and ask me to correct or delete it. If the GDPR or the UK GDPR applies to you, you can also object to or restrict how it is used and receive a copy of it. Because I hold almost nothing about anyone, requests are usually quick: email me.

If you're unhappy with how I've handled your data, you can complain to Israel's [Privacy Protection Authority](https://www.gov.il/en/departments/the_privacy_protection_authority), or to the data-protection authority where you live.

## Children

CopyCam is not aimed at children, and it collects nothing from anyone, which includes children.

## Changes

If I change this policy I'll update the date at the top. The full history of every change is public in [the repository](https://github.com/copycam/copycam/commits/main/docs/legal/privacy.md).
