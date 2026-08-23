# Building the Android app

Capacitor wraps the same web build into a native app, so there is one codebase
rather than a separate phone app to keep in step.

## One-time setup on a new machine

`android/local.properties` is machine-specific and git-ignored, so it does not
exist on a fresh clone. Create it pointing at your Android SDK:

```
sdk.dir=C:/Users/YOU/AppData/Local/Android/Sdk
```

**Use forward slashes.** This is a Java properties file, where a backslash is an
escape character. A Windows path with single backslashes is silently mangled,
and Gradle then fails with the thoroughly unhelpful:

```
java.io.IOException: The filename, directory name, or volume label syntax is incorrect
```

## Building

The Android Gradle Plugin does not accept the newest JDKs. Android Studio ships
a compatible one — point `JAVA_HOME` at it rather than installing another:

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"   # JDK 21

npm run build              # compile the web app into dist/
npx cap sync android       # copy dist/ into the Android project
./android/gradlew -p android assembleDebug
```

The APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`, about
8.8MB. Roughly 13MB of that before compression is Postgres compiled to
WebAssembly — the app carries its own database so it works with no signal.

**Check the exit code, not just the log tail.** Piping gradlew through `tail`
masks its exit status, and a failed build can look like a successful one.

## Installing on a phone

Enable Developer Options and USB debugging on the phone, then:

```bash
"$ANDROID_HOME/platform-tools/adb" install -r \
  android/app/build/outputs/apk/debug/app-debug.apk
```

Or copy the APK to the phone and open it, allowing installation from unknown
sources. A debug APK is signed with a throwaway debug key — fine for testing,
not for distribution.

## Not yet done

- **iOS.** Xcode is macOS only, so that target needs a Mac or a cloud build
  service. Nothing in the codebase blocks it; the platform simply cannot be
  added from Windows.
- **The app id** is `com.farmhand.app`, a placeholder. Settle it before any
  store submission — changing it afterwards means a new listing with no
  reviews or installs.
- **Release signing.** A debug APK cannot go to the Play Store; that needs a
  keystore and a signed release build.
- **Auth deep links.** Supabase email confirmation redirects to a web URL,
  which will not return to the app. Either disable email confirmation or
  configure deep links before relying on sign-up from the phone.
