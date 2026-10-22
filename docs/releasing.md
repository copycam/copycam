# Releasing a new version

Publishing is done by hand, from your own computer, because npm asks for your passkey.

1. **Write the release notes.** Add an entry for the new version at the top of [CHANGELOG.md](../CHANGELOG.md), saying what a user would notice. A test fails if the changelog has no entry for the version in `package.json`.
2. **Bump the version** (this changes `package.json` and `package-lock.json` and creates no git tag):
   ```bash
   npm version patch --no-git-tag-version
   ```
   Use `minor` for new features and `major` for changes that break existing users. If you edited the dependencies, also run `npm run notices` so `THIRD_PARTY_NOTICES.md` matches.
3. **Check it.**
   ```bash
   npm test
   npm run lint
   npm run smoke
   ```
   `npm run smoke` packs the package, installs it into an empty folder, and checks that it reads text offline and serves the phone page.
4. **Commit and push** to `main`, and wait for the checks on GitHub (Actions and the Cloudflare build) to go green.
5. **Publish** from the repository folder:
   ```bash
   npm login
   npm publish
   ```
   Approve the passkey prompts in the browser. npm says the package "may take a few minutes to become available".
6. **Verify it.**
   ```bash
   npm view copycam version
   ```
   Then, in an empty folder, run `npx copycam@latest` and scan the QR code with a phone.
7. **Tag it** so the repository records what was published:
   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```
