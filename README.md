# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

## Google STT（語音轉文字）注意事項

本專案使用 `expo-av` 的 `HIGH_QUALITY` 錄音，預設輸出多半是 **m4a/AAC**。但 **Google Speech-to-Text v1 不支援 AAC**，所以前端不能直接呼叫 `speech:recognize`。

本專案已加上一個小型後端 `server/`，流程是：**前端上傳 base64(m4a) → 後端用 ffmpeg 轉成 FLAC → 呼叫 Google STT → 回傳文字**。

### 啟動 STT server

1. 在專案根目錄建立 `.env`（可由 `env.example.txt` 複製），至少填入：

   - `EXPO_PUBLIC_GOOGLE_API_KEY=...`
   - `EXPO_PUBLIC_STT_SERVER_URL=http://你的IP:3001/stt`

2. 安裝並啟動後端：

   ```bash
   cd server
   npm install
   npm run start
   ```

3. 啟動 Expo：

   ```bash
   npm run start
   ```

> 如果你用手機實機跑 Expo Go：`EXPO_PUBLIC_STT_SERVER_URL` 不能用 `localhost`，要改成你電腦在同一個 Wi‑Fi 下的區網 IP（例如 `http://192.168.x.x:3001/stt`）。

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
