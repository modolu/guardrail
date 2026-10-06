# Solana dApp Store Submission Prep

**Status: not submitted, not published.** This file is a preparation checklist. No listing exists and no URL below has
been created. Requirements for the dApp Store change; every item marked **CONFIRM** was written from general knowledge
and must be checked against the current official Solana Mobile publisher documentation before submitting. This file
deliberately does not state exact asset dimensions, fees or review rules, because they could not be verified in this
session.

## Decisions needed from the owner

1. **Devnet-only app in a store listing.** GuardRail only runs against Solana Devnet. Confirm that the dApp Store
   accepts a Devnet-only app, and how reviewers expect it to be described. If it does not, publication is not possible
   without a mainnet build, which is out of scope (see [README](../README.md#limitations-and-unverified-items)).
2. **Publisher wallet and fees.** Publishing normally involves a publisher wallet and on-chain publishing steps that
   may cost real SOL on mainnet. GuardRail's rule of "no mainnet transactions" applies to the app, not to store
   publication, but this is still a mainnet spend and needs explicit approval. **CONFIRM** cost and process.
3. **Publisher identity**: individual or organisation name, support email, website. Not decided.

## App metadata

- **App name:** GuardRail (from `app.json`)
- **Android package:** `com.guardrail.app` (from `app.json`)
- **Version:** `1.0.0`, Android `versionCode` 1 (both in `app.json`). Increase `versionCode` for every uploaded build.
- **Category:** Tools, Utilities or Security, whichever the store offers. **CONFIRM** category list.
- **Short description (draft):** Review and revoke SPL Token delegate permissions on your Solana wallet (Devnet).
- **Source code:** <https://github.com/modolu/guardrail>
- **License:** not chosen. **TODO** add a LICENSE file.
- **Privacy policy:** no URL. **TODO** write and host one.
- **Support contact:** not decided. **TODO**
- **Website:** none (optional).

### Long description (draft)

> GuardRail connects to your existing Solana wallet with Mobile Wallet Adapter and lists the addresses that are
> currently approved as delegates on your standard SPL Token accounts. Each entry is explained in plain language: which
> address, which token account, and the maximum amount it can transfer or burn while the approval remains active. For a
> supported delegate you can review exactly what a revoke will change, approve a single SPL Token Revoke instruction in
> your wallet, and GuardRail then confirms the transaction and re-reads the token account to verify the delegate is gone.
>
> GuardRail reports on-chain facts only. It does not rate addresses, does not call any address malicious, and does not
> say a wallet is safe. This version runs on Solana Devnet only and supports standard SPL Token accounts; Token-2022,
> other authority types and mainnet are not supported.

### Data and permissions statement (draft, must match the shipped build)

- No backend, accounts, analytics, crash reporting or advertising SDKs.
- The app reads public on-chain data from the configured Devnet RPC (default `https://api.devnet.solana.com`), so that
  RPC provider sees the connected wallet address and the app's IP address.
- Private keys never reach GuardRail. Signing happens in the user's wallet app through Mobile Wallet Adapter.
- Android permissions: the generated main manifest requests `INTERNET` and the template's `VIBRATE` (the app does not
  vibrate). `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` are removed via
  `android.blockedPermissions` in `app.json`. **TODO** once an APK is built, confirm the final merged list with
  `aapt dump permissions`; libraries can add permissions during the Gradle manifest merge.

## Assets

Prepare these; **CONFIRM** exact formats, sizes and counts in the publisher docs first.

- [ ] App icon (store listing). `assets/images/icon.png`, the adaptive icon layers (`android-icon-*.png`) and
      `splash-icon.png` are all still the **Expo template defaults**. Replace them before submitting.
- [ ] Banner / feature graphic, if the listing requires one.
- [ ] Phone screenshots of the real app on Android: connect, scan result, permission detail, revoke review, verified
      result. **Cannot be captured yet: no device or emulator.**
- [ ] Optional demo video (the same video as in [SUBMISSION.md](SUBMISSION.md)).
- [ ] Release APK, signed with a release keystore.

## Build and signing

- [ ] Install Java and the Android SDK (not installed on the current build machine, see
      [BUILD_ENVIRONMENT.md](BUILD_ENVIRONMENT.md)).
- [ ] `npm run android:build` (Expo prebuild) then `cd android && ./gradlew assembleRelease`, or EAS Build. Steps
      are in [BUILD_ENVIRONMENT.md](BUILD_ENVIRONMENT.md#release-apk-not-built-yet).
- [ ] Create a release keystore **outside the repo** (`*.keystore`, `*.jks` and `keystore.properties` are gitignored).
      Back it up; losing it blocks future updates. Never commit it or its passwords. The generated project signs
      `release` with the template debug key until this is configured.
- [ ] Install the release APK on a device and run the manual checklist in [DEMO.md](DEMO.md) against the release
      build, not only a debug build.
- [ ] Confirm the release build points at Devnet and uses no private RPC key (`EXPO_PUBLIC_*` values are embedded in the
      app bundle and are readable by anyone who has the APK).

## Publisher steps (CONFIRM each against current docs)

- [ ] Publisher account / wallet set up
- [ ] App listing created with the metadata above
- [ ] Release created with the signed APK
- [ ] Submission made and review feedback handled
- [ ] Listing URL recorded in [SUBMISSION.md](SUBMISSION.md) **only once it exists**

## Reviewer notes (draft)

- The app needs an MWA-compatible wallet on the same device, set to Devnet, controlling an account that has an SPL Token
  delegate. Provide the fixture steps from [DEMO.md](DEMO.md) or a pre-funded test wallet. Never include a secret key
  in the submission text.
- With no delegate present the app shows "No supported active delegates" and that is the expected result.
