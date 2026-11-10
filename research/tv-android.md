# Android TV 工程调研报告：DeepSeek Office（像素办公室 + 鲸鱼娘）

> 调研时间：2026-11-10（Asia/Shanghai）
> 调研人：tv-android-engineer（research teammate）
> 适用范围：**只做调研，不包含已创建的 Android 工程文件**。本文件是 `deepseek-office-tv/tv-app/` 的实现依据。
> 与 `deepseek-office-tv/CONTRACT.md`（v1，Lead 冻结）的关系：**契约已经选定「WebView 瘦客户端」方案**。本报告第 5 节对比了三种渲染路线，结论是「v1 按契约用 WebView 可行，但必须做 4 项硬化；若要长时间离线稳定，原生 Canvas 才是终局」。契约里的按键/TTS/清单要求，本报告给出可落地的实现细节与实测数据。
> 本报告中标注「实测」的结论，均在本机（macOS 27 arm64）跑过；标注「不确定/需真机验证」的，请当作待验证假设。

---

## 0. 结论速览（TL;DR）

| 问题 | 结论 |
|---|---|
| 渲染方案 | **v1：WebView 全屏加载 Mac bridge 的 `/tv` 页（按契约）**，但需：① 启动检查 WebView 版本 ② 压 1080p Canvas 负载、限制渲染分辨率 ③ 长跑内存清理 ④ 断网重试不白屏。**长跑/离线终局：原生 Kotlin `SurfaceView + Canvas`（低分辨率离屏 buffer 放大），无 native 依赖、APK < 3 MB、RAM < 100 MB。** 不推荐游戏引擎（Godot/Unity/Cocos）。 |
| 长按 OK | **`Activity.dispatchKeyEvent` + 600ms `Handler` 计时器**（自己算 down/up 时长），吞掉重复事件；`startTracking()/onKeyLongPress` 只作兜底（它依赖遥控器产生 repeat 事件，很多盒子不发）。不要依赖 `setOnLongClickListener`。OK 键必须同时认 `DPAD_CENTER(23)/ENTER(66)/NUMPAD_ENTER(160)/BUTTON_A(96)/BUTTON_SELECT(109)`。 |
| TTS | 便宜盒子**常常没有中文 TTS 引擎**，`TextToSpeech` 初始化会失败；**v1 用系统 TTS + 失败静默**；可靠路线是「**预生成固定台词音频 + 云 TTS（走自建代理，key 不进 APK）+ 可选 sherpa-onnx 离线引擎**」。 |
| 语音输入 | **遥控器 mic 键在普通 App 里拿不到**（`KEYCODE_VOICE_ASSIST` 官方明确 "Not delivered to applications"，点按是拉起系统/厂商语音助手）。`RecognizerIntent` 依赖设备上有 `RecognitionService`，国产盒子基本没有。**可行路线：USB 麦克风 + `AudioRecord` 16 kHz PCM + 云端流式 ASR；或手机当麦克风（companion App）**。 |
| 本机能否构建 | **能。** 已实测：AGP 8.13.2 + Gradle 9.4.1 + Kotlin 2.2.21 + JDK 17 + compileSdk 35/36 → `BUILD SUCCESSFUL`，产出可安装 debug APK；离线构建也通过；另外实测了**不用 Gradle** 的 aapt2+d8+apksigner 路径（产出 2.7 KB 签名 APK）。**但本会话沙箱下必须设置 `GRADLE_USER_HOME` 与 `ANDROID_USER_HOME` 到可写目录**（详见 1.3）。 |
| 真机安装验证 | 本机 `adb devices` 为空、没有可用 TV 模拟器镜像 → **`adb install` 与截图未实测**，第 8.5 节给出命令与预期输出。 |

---

## 1. 本机环境实测（2026-11-10）

### 1.1 工具链清单（实测）

| 项 | 实际值 | 备注 |
|---|---|---|
| OS / CPU | macOS 27.0.1，Darwin 27.0.0，**arm64（Apple Silicon）** | 构建出的是通用 APK（本项目无 so） |
| JDK | `java 17.0.15`（Homebrew，arm64）；另有 Zulu 24.0.1 | `JAVA_HOME` **默认未设置**；`/usr/libexec/java_home -V` 默认指向 24。Gradle 建议显式指定 JDK 17。AGP 8.x 要求 JDK 17。 |
| `gradle` 命令 | **不在 PATH** | 但 `~/.gradle/wrapper/dists/` 下已有两个完整发行版：`gradle-9.0.0-bin/…/gradle-9.0.0/bin/gradle`、`gradle-9.4.1-bin/…/gradle-9.4.1/bin/gradle`，可直接调用 |
| Android SDK | `ANDROID_HOME=/Users/huhuanming/Library/Android/sdk` | 已设置 |
| platforms | android-30 / 31 / 32 / 34 / **35** / **36** / 37.0 | compileSdk 35、36 都可用 |
| build-tools | 34.0.0 / **35.0.0** / **36.0.0** / 37.0.0 | 含 `aapt2`、`d8`、`apksigner`、`zipalign`、`apksigner` |
| cmdline-tools | `latest`（apkanalyzer / avdmanager / d8 / lint / r8 / sdkmanager） | |
| platform-tools | adb 1.0.41（36.0.0） | |
| NDK | 27.0 / 27.1 / 28.2 | 本项目不需要 |
| debug keystore | `~/.android/debug.keystore` 存在（alias `androiddebugkey`，store/key 密码都是 `android`） | 本会话沙箱**不可写** `~/.android`，见 1.3 |
| 已缓存 AGP | 8.1.1 / 8.2.1 / 8.3.0 / 8.5.0 / 8.7.2 / 8.8.0 / 8.8.2 / **8.10.1 / 8.12.0 / 8.12.2 / 8.13.2** / 9.2.1 / 9.3.1 | 8.13.2 与 Gradle 9.4.1 组合已实测可用 |
| 已缓存 Kotlin 插件 | 1.9.25 / 2.1.20 / 2.2.0 / 2.2.10 / **2.2.21** | 2.2.21 已实测可用 |
| 网络 | `dl.google.com`、`maven.google.com`、`repo1.maven.org`、`services.gradle.org` 全部 HTTP 200 | **可在线构建**；首次解析后可 `--offline` |
| 连接设备 | `adb devices` → **空** | 无真机；AVD 里只有手机/平板镜像，`system-images` 还是外接卷软链（未确认 TV 镜像） |

### 1.2 已实测的构建矩阵

| 实验 | 配置 | 结果 |
|---|---|---|
| A. Kotlin + Gradle（通用） | AGP **8.13.2** + Gradle **9.4.1** + Kotlin **2.2.21** + JDK17 + compileSdk **36** + minSdk 23 + targetSdk 36 | ✅ `BUILD SUCCESSFUL`，`app-debug.apk` **858,576 B** |
| B. Java-only Gradle | 同 A 但纯 Java | ✅ `app-debug.apk` **8,872 B** |
| C. **契约版本组合** | 包名 `dev.dsh.office.tv`、compileSdk **35**、minSdk **21**、targetSdk **34** | ✅ `BUILD SUCCESSFUL`（`--offline`），`app-debug.apk` **858,345 B** |
| D. 二次离线构建 | 缓存已热后 `--offline` | ✅ 成功（无网络也能出包） |
| E. 生成 wrapper | `gradle wrapper --gradle-version 9.4.1` | ✅ 生成 `gradlew`、`gradle/wrapper/gradle-wrapper.jar`、`gradle-wrapper.properties` |
| F. **无 Gradle**（aapt2 + javac + d8 + zipalign + apksigner） | build-tools 36.0.0 + platforms/android-36/android.jar + debug keystore | ✅ 产出 `app-debug.apk` **2,689 B**；`apksigner verify`：v1/v2/v3 全部 `true`；`aapt2 dump badging` 能识别 `leanback-launchable-activity` 与 `uses-feature-not-required: touchscreen/leanback` |

结论：**本机具备完整可用的 Android 构建能力**（在线/离线、Gradle/无 Gradle 都行），唯一缺口是**没有可安装的真机/TV 模拟器**。

### 1.3 ⚠️ 本会话沙箱的两个坑（tv-app-builder 必读）

本会话的文件策略是 `workspace-write`：**只有 workspace 内可写**。直接跑 Gradle 会连续撞两个错误：

1. `Could not initialize native services / Failed to load native library 'libnative-platform.dylib'`（真实原因：`/Users/…/.gradle/native/…/libnative-platform.dylib.lock (Operation not permitted)`）
   → 解决：把 Gradle 用户目录指到可写位置。
2. `Unable to create debug keystore in /Users/…/.android because it is not writable`
   → 解决：`ANDROID_USER_HOME` 指到可写目录，并把已有 debug keystore 复制进去。

可复制的环境准备（任意目录执行一次）：

```bash
export JAVA_HOME=/opt/homebrew/Cellar/openjdk@17/17.0.15/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
# 仅本会话沙箱需要；正常开发机用默认 ~/.gradle / ~/.android 即可
export GRADLE_USER_HOME=/tmp/gradlehome
export ANDROID_USER_HOME=/tmp/androidhome
mkdir -p "$GRADLE_USER_HOME" "$ANDROID_USER_HOME"
cp "$HOME/.android/debug.keystore" "$ANDROID_USER_HOME/" 2>/dev/null || true

# 没有 gradle 命令时，直接用本机已缓存的发行版
GRADLE=$(ls -d "$HOME"/.gradle/wrapper/dists/gradle-9.4.1-bin/*/gradle-9.4.1/bin/gradle | head -1)
"$GRADLE" --version
```

> 说明：`/tmp/gradlehome` 每次开机可能被清空，清空后首次构建需联网重新下载 AGP/Kotlin 依赖；也可以换成 workspace 内目录（如 `deepseek-office-tv/.gradle-home`），但别提交进 git。

---

## 2. TV 应用清单与配置

### 2.1 最小可用 AndroidManifest.xml（本项目版）

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <!-- 1) TV 没有触摸屏：必须声明 not-required，否则不会被当作 TV 应用（Play 直接过滤） -->
    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />
    <!-- 2) leanback 必须 required=false：true 的话手机/平板装不上，且 Play 只投 TV -->
    <uses-feature android:name="android.software.leanback" android:required="false" />
    <!-- 3) 麦克风是“以后要加语音”才需要；现在就声明 not-required，避免盒子没有麦克风导致装不上 -->
    <uses-feature android:name="android.hardware.microphone" android:required="false" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:banner="@drawable/tv_banner"        <!-- 320x180 xhdpi，图里要带 App 名 -->
        android:usesCleartextTraffic="true"          <!-- 局域网 http://<mac-ip>:8765/tv 需要 -->
        android:hardwareAccelerated="true">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTask"
            android:screenOrientation="landscape"
            android:configChanges="keyboard|keyboardHidden|navigation|orientation|screenSize|screenLayout|smallestScreenSize|uiMode"
            android:theme="@android:style/Theme.Black.NoTitleBar.Fullscreen">

            <!-- TV 桌面 + 普通桌面都声明；两个 category 可以放同一个 filter -->
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

    <!-- targetSdk >= 30 的包可见性：让 TTS 引擎 / 语音识别服务能被发现 -->
    <queries>
        <intent><action android:name="android.intent.action.TTS_SERVICE" /></intent>
        <intent><action android:name="android.speech.RecognitionService" /></intent>
    </queries>
</manifest>
```

### 2.2 逐项解释

| 配置 | 为什么必须 | 依据 |
|---|---|---|
| `CATEGORY_LEANBACK_LAUNCHER` | TV 桌面（Google TV / Android TV Launcher）只查询带这个 category 的 Activity；没有它，**应用不出现在 TV 桌面上**（Google Play 也不把它当 TV 应用） | [Create and run a TV app](https://developer.android.com/training/tv/get-started/create) |
| `LEANBACK_LAUNCHER` + `LAUNCHER` 都写 | 国产盒子（当贝桌面/Launcher3/魔改 ROM）不一定按 leanback 找应用，普通 `LAUNCHER` 更容易被“全部应用”列出；两个都写可兼顾 Google TV 与国产盒子 | 同上（官方建议同时提供手机版入口） |
| `android.software.leanback` **required=false** | 设 `true`：Google Play 只投给 Android TV OS，手机/平板/部分国产盒子（不带 leanback feature）装不上。`false` 表示“能在 TV 上跑，也能在别处跑” | 同上 |
| `android.hardware.touchscreen` **required=false** | TV 没有 touchscreen；不声明的话 Play 会把应用过滤掉。**注意：没有 `android.software.touchscreen` 这个 feature 名**（正确名是 `android.hardware.touchscreen`，配套还有 `android.hardware.faketouch`） | [Handle TV hardware](https://developer.android.com/training/tv/get-started/hardware) |
| `android:banner` | TV 桌面用 banner 当启动图；**Play 的 TV 应用质量要求**：320×180 px 全尺寸 banner + 至少 160×160 px（xhdpi）图标；banner 里必须有 App 名。侧载不强制，但部分国产桌面会读它 | [Create and run a TV app](https://developer.android.com/training/tv/get-started/create)、[TV app quality](https://developer.android.com/docs/quality-guidelines/tv-app-quality) |
| `minSdk` | Play TV 质量规则要求 **minSdkVersion ≤ 31**；本项目契约取 **21**（Android 5.0 起）。老盒子 5.1/6/7 都能装；代价是 21/22 上 WebView 很老（见 5.3）。**建议：契约保持 21，但把 23 作为推荐基线**（6.0+，运行时权限模型统一，后面加录音权限简单） | [TV app quality](https://developer.android.com/docs/quality-guidelines/tv-app-quality) |
| `targetSdk` | 契约 34。34 在 Android 14+ 的盒子行为稳定；**不建议现在冲 36**（TV 上新行为未验证，且 Play 政策对 TV 没有强制最新） | — |
| `screenOrientation="landscape"` | TV 永远横屏；避免某些盒子/投屏场景旋转重建 | — |
| `configChanges` 一堆 | 盒子开机、HDMI 切分辨率（1080p↔4K）、切 HDR 时系统会重建 Activity；不拦会导致全屏场景闪一下/重新联网。**SurfaceView/WebView 方案都建议加** | — |
| `launchMode="singleTask"` | 从桌面反复点图标不要叠多个 Activity | — |
| `usesCleartextTraffic="true"` | 契约里的 `http://<mac-ip>:8765/tv` 是明文；Android 9+ 默认禁止明文 | — |
| `<queries>` | targetSdk ≥ 30 的包可见性限制；不声明的话 `TextToSpeech` 找不到引擎、`SpeechRecognizer` 找不到服务（表现是“明明装了却不可用”） | [TextToSpeech](https://developer.android.com/reference/android/speech/tts/TextToSpeech) |

### 2.3 为什么只有普通 `LAUNCHER` 的应用在 TV 上会“消失”

官方原话（TV 入门文档 Caution）：

> If you don't include the `CATEGORY_LEANBACK_LAUNCHER` intent filter in your app, it's not visible to users running Google Play on TV devices. Also, if your app doesn't have this filter when you use developer tools to load it onto a TV device, **the app does not appear in the TV user interface**.

也就是说：

- **Google TV / 认证 Android TV 桌面**：只列 `LEANBACK_LAUNCHER` 的应用（或 Play 上架的 TV 应用）。只有 `LAUNCHER` 的 App 装上了也看不到图标，只能 `adb shell am start` 拉起，或在“设置 → 应用”里找。
- **国产盒子**（当贝桌面、Launcher3、小米 PatchWall、运营商定制桌面）：多数会扫描普通 `LAUNCHER`，所以只写 `LAUNCHER` 有时反而能显示；但不同版本/不同厂商行为不一致，**不能押注**。
- 因此正确做法：**一个 Activity 同时挂 `LAUNCHER` + `LEANBACK_LAUNCHER`**（如上），两边都覆盖，零成本。

### 2.4 其他 TV 必需的运行时设置

```kotlin
// MainActivity.onCreate / onResume
window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)   // 小孩会开着几小时，别让盒子屏保/休眠

// 沉浸式全屏（API 21+ 通用写法；API 30+ 的 WindowInsetsController 更现代但兼容性差）
@Suppress("DEPRECATION")
private fun enterImmersive() {
    window.decorView.systemUiVisibility = (
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        )
}
```

---

## 3. 侧载到国产电视盒子

### 3.1 标准流程（ADB over LAN，推荐）

```bash
# 0) 先让盒子与 Mac 在同一局域网（同一路由器/同一 VLAN，别用访客网络）
adb devices                                   # 确认当前没有冲突设备
adb connect 192.168.1.23:5555                 # 盒子 IP:端口，多数盒子是 5555
adb devices -l                                # 看到 "<ip>:5555  device" 才算连上

# 1) 看盒子基本盘：Android 版本、ABI、CPU
adb shell getprop ro.build.version.release    # 例：9
adb shell getprop ro.build.version.sdk        # 例：28
adb shell getprop ro.product.cpu.abi          # 例：arm64-v8a
adb shell getprop ro.product.cpu.abilist      # 例：arm64-v8a,armeabi-v7a,armeabi
adb shell getprop ro.product.model            # 例：MIBOX4 / DBOS-…

# 2) 安装（-r 覆盖、-d 允许降级、-g 授权清单里的全部运行时权限）
adb install -r -d -g app/build/outputs/apk/debug/app-debug.apk

# 3) 拉起 + 看日志
adb shell am start -n dev.dsh.office.tv/.MainActivity
adb logcat -s DshTv:V AndroidRuntime:E
```

盒子侧需要打开的两个开关（各厂商入口不同）：

1. **开发者选项**：设置 → 关于/系统信息 → 连续点“版本号”5~7 次；
2. **ADB 调试 / 网络调试**：开发者选项里打开（部分小米设备叫“ADB 调试”，需要登录小米账号且在同一 Wi-Fi；部分运营商盒子在“高级设置”里）；
3. 安装时如果弹“**是否允许安装未知来源应用**”，必须点允许（部分盒子在 设置 → 安全 → 未知来源）。

### 3.2 各品牌差异与真实坑（部分为经验值，标注不确定）

| 品牌/类型 | 开 ADB | 第三方安装 | 备注 |
|---|---|---|---|
| 小米盒子 / 小米电视 | 设置 → 账号与安全 → **ADB 调试**（需登录小米账号；部分机型还要求“USB 调试”+ 同 Wi-Fi） | 允许“未知来源” | 已知坑：`INSTALL_FAILED_USER_RESTRICTED` → 需要打开“USB 安装/允许安装未知应用”，个别 MIUI 系盒子要关“MIUI 优化”后重试（**不确定**） |
| 当贝盒子 / 当贝 OS | 设置 → 关于 → 连点版本号 → 开发者选项 → **ADB 调试** | 宽松，通常直接装 | 也可以 U 盘 + 当贝市场安装 |
| 天猫魔盒（阿里 YunOS 魔改） | **通常没有标准 ADB**（部分固件可开，型号差异大） | 受限，常需 U 盘/当贝市场/特定固件 | **不确定，必须按具体型号实测**；建议不要把它作为首发目标机型 |
| 运营商 IPTV/OTT 盒子 | 多数被固件锁掉 ADB/未知来源 | 常只能装白名单应用 | **不确定**；这类盒子可能需要刷机/开工厂模式，不适合作为开发验证机 |
| 通用 Amlogic S905/S905X 外贸盒子 | 设置 → 开发者选项 → ADB | 直接开 | 最适合做开发机（便宜、ROM 干净、adb 5555 常开） |

补充：

- **ADB over Wi-Fi 的 5555 端口**：多数 Amlogic 盒子默认开；有些需要先 USB 连上执行 `adb tcpip 5555` 再拔线；盒子重启后要重新 `adb connect`。
- 如果 adb 连不上但盒子能装 U 盘 APK：用 U 盘 + 盒子自带“文件管理/媒体中心”点 APK 安装，作为兜底。
- **同一局域网**是硬要求；公司/酒店网络常开 AP 隔离，会导致 `adb connect` 失败（`Connection refused`/超时）。

### 3.3 安装失败码对照表（真机上最常见）

| 报错 | 原因 | 处理 |
|---|---|---|
| `INSTALL_FAILED_NO_MATCHING_ABIS` | APK 里只有 arm64 的 `.so`，盒子是 32 位用户空间（老 S905 常见：CPU 是 arm64，但 Android 用户空间只有 armeabi-v7a） | 先 `adb shell getprop ro.product.cpu.abilist`；**本项目无 native 库，天然免疫**；以后接 sherpa-onnx 时必须同时打 arm64-v8a + armeabi-v7a |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` / `INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES` | 新旧 APK 签名不同（debug 与 release 混装） | `adb uninstall dev.dsh.office.tv` 后重装 |
| `INSTALL_FAILED_OLDER_SDK` | 盒子 Android 版本 < `minSdk` | 降低 minSdk（契约 21 已覆盖 Android 5.0+） |
| `INSTALL_FAILED_USER_RESTRICTED` | 厂商 ROM 限制（小米/部分定制盒） | 打开“USB 安装/未知来源”；或换机（**不确定**） |
| `INSTALL_FAILED_INVALID_APK` | APK 损坏 / 签名方案不匹配（Android 7 以下需要 v1；Android 7+ 需要 v2） | `apksigner verify -v` 检查；apksigner 默认 v1+v2（前提 `--min-sdk-version` 设对） |
| `INSTALL_FAILED_ALREADY_EXISTS` | 已装同包名（未加 `-r`） | `adb install -r` |
| `Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]` | 盒子存储满 | 清缓存/换盒子 |

### 3.4 安装后的验证命令（也是验收标准）

```bash
# 截图（官方推荐 exec-out，避免 shell 管道二进制损坏）
adb exec-out screencap -p > tv-shot.png

# 模拟按键（和真遥控等效的 InputManager 注入）
adb shell input keyevent 23                  # OK：短按 = 戳一下
adb shell input keyevent --longpress 23      # OK：长按（>=600ms）= 打开聊天面板
adb shell input keyevent 4                   # BACK：先关面板
adb shell input keyevent 19                  # UP
adb shell input keyevent 20                  # DOWN
adb shell input keyevent 21                  # LEFT
adb shell input keyevent 22                  # RIGHT
adb shell input keyevent 82                  # MENU（部分遥控器没有）

# 进程/内存/掉帧
adb shell dumpsys meminfo dev.dsh.office.tv
adb shell dumpsys gfxinfo dev.dsh.office.tv | head -40
adb shell ps -A | grep dsh

# 强制停止/卸载
adb shell am force-stop dev.dsh.office.tv
adb uninstall dev.dsh.office.tv
```

> `adb shell input keyevent --longpress 23` 是 `input` 命令自带的长按模拟，用来快速自测够用；它不能完全代表真实遥控器（真实遥控器的 repeat 行为差异见 4.4），上线前必须在真遥控器上按一遍。

---

## 4. 遥控器按键与长按（本项目核心交互）

### 4.1 KeyCode 速查表（`android.view.KeyEvent`）

| 常量 | 值 | 说明 |
|---|---|---|
| `KEYCODE_DPAD_CENTER` | **23** | 最常见 OK 键 |
| `KEYCODE_ENTER` | **66** | 另一批盒子/遥控的 OK 键（**必须一起认**） |
| `KEYCODE_NUMPAD_ENTER` | **160** | 少数遥控/键盘式遥控 |
| `KEYCODE_BUTTON_A` | **96** | 手柄/部分游戏遥控的“确认” |
| `KEYCODE_BUTTON_SELECT` | **109** | 同上 |
| `KEYCODE_DPAD_UP/DOWN/LEFT/RIGHT` | 19 / 20 / 21 / 22 | 方向 |
| `KEYCODE_BACK` | **4** | 返回 |
| `KEYCODE_MENU` | **82** | 菜单（很多遥控没有） |
| `KEYCODE_HOME` | 3 | 系统键，App 收不到/不应拦 |
| `KEYCODE_MEDIA_PLAY_PAUSE` | **85** | 播放/暂停 |
| `KEYCODE_VOICE_ASSIST` | **231** | 语音助手键：**系统消费，不投递给应用**（见 7.1） |
| `KEYCODE_SEARCH` | 84 | 搜索键（老遥控常见） |

官方“控制器 → 行为”映射表明确把 **`BUTTON_SELECT` / `BUTTON_A` / `ENTER` / `DPAD_CENTER` / `NUMPAD_ENTER` 统一视为“Selection”（确认）**，把 `BUTTON_B` / `BACK` 视为“Back”。所以 OK 键绝不能只判 23：
[Manage TV controllers](https://developer.android.com/training/tv/get-started/controllers)

### 4.2 长按三种实现对比（含 AOSP 依据）

| 方案 | 原理 | 依赖 | 优点 | 致命问题 |
|---|---|---|---|---|
| **A. `dispatchKeyEvent` + 自建计时器**（**推荐**） | 在 Activity 最早入口收 DOWN/UP，自己记录 down 时间、`postDelayed` 600ms 触发长按 | 无（不依赖 repeat、不依赖焦点） | 盒子只发一次 DOWN 也能长按；阈值可调；长按在按住时立即触发；短按/长按互斥干净 | 需要自己实现状态机（代码见 4.3） |
| B. `event.startTracking()` + `onKeyLongPress()` | 框架在 DOWN 时开始跟踪，按住超时后给下一次事件打 `FLAG_LONG_PRESS` 并回调 `onKeyLongPress` | **必须有 repeat 事件**（很多红外遥控不发 repeat → 永不触发） | 系统级语义标准，GMS/蓝牙遥控体验好 | 兼容性看遥控器；Activity 里还要保证 `startTracking` 在 `onKeyDown` 且返回 true、走 `super.dispatchKeyEvent` |
| C. `View.setOnLongClickListener()` | AOSP `View.onKeyDown()` 对 confirm 键（23/66/160/空格）调用 `checkForLongClick(ViewConfiguration.getLongPressTimeout())` | **必须有聚焦的、clickable/longClickable 的 View** | 一行代码 | 阈值固定 500ms 不可调；焦点被抢/没有可聚焦 View 时不触发；全屏 SurfaceView 场景没有焦点目标 |

AOSP 依据（`frameworks/base/core/java/android/view/KeyEvent.java`、`View.java`，本机拉源码确认）：

- `KeyEvent.Callback.onKeyLongPress` 文档：**必须有人从 `onKeyDown` 返回 true 并调用 `startTracking()`**，才会收到长按回调。
- `KeyEvent.dispatch()`：只有收到 `isLongPress() && state.isTracking()` 的事件时才回调 `onKeyLongPress` —— 也就是**依赖后续事件**（repeat）；遥控器不发 repeat 就没有“后续事件”。
- `View.onKeyDown()`：`if (KeyEvent.isConfirmKey(keyCode) && event.hasNoModifiers())` → `checkForLongClick(ViewConfiguration.getLongPressTimeout(), …)`；`isConfirmKey` 仅含 `DPAD_CENTER / ENTER / SPACE / NUMPAD_ENTER`。

**结论：以 A 为主，B 作为兜底（两条路都接，谁先到用谁）；C 只在有正常焦点控件（如聊天面板按钮）时用。**

### 4.3 推荐实现（Kotlin，已用 `kotlinc` 对 `android.jar` 编译通过）

```kotlin
package dev.dsh.office.tv

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager

class MainActivity : Activity() {

    companion object {
        private const val LONG_PRESS_MS = 600L   // 契约：>=600ms 算长按
        private val OK_KEYS = intArrayOf(
            KeyEvent.KEYCODE_DPAD_CENTER,   // 23
            KeyEvent.KEYCODE_ENTER,         // 66
            KeyEvent.KEYCODE_NUMPAD_ENTER,  // 160
            KeyEvent.KEYCODE_BUTTON_A,      // 96
            KeyEvent.KEYCODE_BUTTON_SELECT  // 109
        )
    }

    private val handler = Handler(Looper.getMainLooper())
    private var downAt = 0L
    private var longPressFired = false

    /** 到点立即触发，不等抬手 */
    private val longPressJob = Runnable {
        longPressFired = true
        onLongOk()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_main)   // 里面是 WebView（v1）或 SurfaceView（v2）
        enterImmersive()
    }

    override fun onResume() {
        super.onResume()
        window.decorView.requestFocus()   // 保证按键进 dispatchKeyEvent
    }

    /** 所有按键的唯一入口：比 onKeyDown/OnKeyListener 更早、更可靠 */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode

        if (code in OK_KEYS) {
            when (event.action) {
                KeyEvent.ACTION_DOWN -> {
                    if (event.repeatCount == 0) {          // 只认第一次 DOWN
                        downAt = SystemClock.uptimeMillis()
                        longPressFired = false
                        handler.postDelayed(longPressJob, LONG_PRESS_MS)
                        // 方案 B 兜底：让框架也跟踪一次（有的遥控会发 repeat，能触发 onKeyLongPress）
                        event.startTracking()
                    }
                    return true                            // 吞掉 DOWN 和所有 repeat
                }
                KeyEvent.ACTION_UP -> {
                    handler.removeCallbacks(longPressJob)
                    val held = SystemClock.uptimeMillis() - downAt
                    when {
                        longPressFired -> Unit                  // 已经开过面板，抬手不再戳
                        held >= LONG_PRESS_MS -> onLongOk()     // 主线程卡顿导致计时器没跑到的兜底
                        else -> onShortOk()                     // < 600ms = 戳一下
                    }
                    longPressFired = false
                    return true
                }
                else -> return true                             // 其余 action 一律吞掉
            }
        }

        // BACK：先关面板，再考虑退出；绝不让小孩直接掉回桌面
        if (code == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
            if (onBackPressedCustom()) return true
        }

        // 方向键 / MENU 等交给 WebView 桥或默认处理
        return super.dispatchKeyEvent(event)
    }

    /** 方案 B 的兜底：只有 startTracking 生效时才会走到这里 */
    override fun onKeyLongPress(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode in OK_KEYS) {
            handler.removeCallbacks(longPressJob)
            if (!longPressFired) {
                longPressFired = true
                onLongOk()
            }
            return true
        }
        return super.onKeyLongPress(keyCode, event)
    }

    private fun onShortOk() { /* 桥给网页：window.DshTv.onKey('ok') → 戳一下 */ }
    private fun onLongOk()  { /* 桥给网页：window.DshTv.onKey('long_ok') → 打开聊天面板 */ }
    private fun onBackPressedCustom(): Boolean { /* 面板开着→关；否则 false */ return false }

    @Suppress("DEPRECATION")
    private fun enterImmersive() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
    }
}
```

**关键点：**

1. `dispatchKeyEvent` 是 Activity 收到按键的最早入口；只要窗口有焦点就一定进得来，**不要求任何 View 有焦点**。
2. DOWN 时 `repeatCount == 0` 才建计时器；**`repeatCount > 0` 的重复事件直接吞掉**，不能当成“又按了一次”。
3. 长按在**按住 600ms 时立即触发**（体验好），同时也处理“抬起时已超时但计时器没跑”的兜底。
4. 短按只在 UP 且 `< 600ms` 且“长按没触发过”时发 `ok`，所以长按松手不会误触发“戳一下”。
5. `event.startTracking()` 只是兜底；**不要把它当主路径**（4.2 表 B）。

### 4.4 短按/长按/重复事件状态机（不同遥控器行为）

| 遥控器行为 | 现象 | 本实现是否覆盖 |
|---|---|---|
| 标准：按住会发 repeat（`repeatCount` 递增） | DOWN、DOWN×N、UP | ✅ 忽略 repeat，600ms 计时器触发长按 |
| 只发一次 DOWN 然后 UP（很多便宜红外遥控） | DOWN、UP | ✅ 计时器照样触发长按 |
| 松手时补发 repeat 再 UP（个别固件） | DOWN、DOWN(repeat)、UP | ✅ 忽略 repeat |
| 按键连击（小孩快速戳） | DOWN/UP ×N | ✅ 每次 UP<600ms 发一次 `ok`（可加 150ms 防抖） |
| 只发 UP 不发 DOWN（极少数 BT 遥控异常） | UP | ⚠️ `held` 为 0 → 当作短按；建议记录“无 DOWN 的 UP”直接忽略 |
| OK 键是 `ENTER(66)` 而非 `DPAD_CENTER(23)` | — | ✅ 已在 `OK_KEYS` 集合里 |
| 遥控器 OK 键发 `BUTTON_A`（手柄/游戏遥控） | — | ✅ 已覆盖 |

> 建议加 150~200ms 的“短按防抖”，避免小孩连戳导致动画/请求风暴；长按阈值 600ms 与契约一致（500ms 会太灵敏，800ms 小孩会以为没反应）。

### 4.5 焦点处理（TV 上“按键没反应”的头号原因）

- **必须有 View 持有焦点**：`requestFocus()` 在 `onCreate` 或 `onResume` 里调用；根容器 `android:focusable="true"`、`android:focusableInTouchMode="true"`。
- **不要**在根布局上设 `android:descendantFocusability="blocksDescendants"`（会把子控件焦点全禁掉，聊天面板按钮点不了）。
- WebView 方案：`webView.isFocusable = true; webView.requestFocus()`，否则触摸/点击语义不对（按键走 Activity 桥，不依赖 WebView 焦点）。
- 聊天面板（Dialog / 新 Activity / 覆盖层）打开时**必须显式把焦点给面板里的第一个可聚焦控件**；关闭后把焦点还给场景/WebView，否则方向键会“卡死”。
- 悬浮窗/覆盖层不要加 `FLAG_NOT_FOCUSABLE`，否则按键收不到。
- 监听 `onWindowFocusChanged(hasFocus)`：失焦时暂停动画，回来时恢复并重新 `requestFocus()`。
- 国产盒子桌面/系统弹窗可能抢焦点（尤其开机广告、系统升级提示），`onWindowFocusChanged` 里做一次恢复。

### 4.6 WebView 与 TV 按键（本项目 v1 的关键）

**事实：WebView 默认不会把遥控器方向键/OK 键交给页面 JS。** 它在 native 层自己消费这些键（滚屏、焦点移动、点击模拟），`keydown` 事件经常收不到（尤其 `DPAD_CENTER`）。所以：

- **不要**指望网页里 `addEventListener('keydown')` 拿到遥控器事件；
- 正确做法：`Activity.dispatchKeyEvent` 拦截 → 通过 `evaluateJavascript("window.DshTv.onKey('ok')")` 桥给页面（正是契约 §4.2 的 `window.DshTv.onKey`）；
- 反向（页面→原生）用 `addJavascriptInterface(nativeBridge, "DshTvNative")`（契约 §4.1），`@JavascriptInterface` 方法注意只在自家页面暴露；
- 网页里做浏览器调试时（桌面 Chrome），用 `Enter`/方向键/`Escape` 映射成同样的 action，便于开发（契约已约定）。

> 这是实践结论（WebView 对 DPAD 的消费行为随 Chromium 版本/厂商 WebView 有差异），**必须在目标盒子上实测**；不确定项已列入第 9 节。

### 4.7 其他按键约定（建议）

| 按键 | 场景 | 行为 |
|---|---|---|
| OK 短按 | 办公室 | `ok`：戳一下（随机 `poke/head_pat/tail` 动画 + 一句台词） |
| OK 长按 ≥600ms | 办公室 | `long_ok`：打开“和鲸鱼娘聊聊”面板 |
| BACK | 面板开着 | 关面板，**不退出 App**（避免小孩掉到桌面） |
| BACK | 办公室 | 第一次提示“再按返回退出”，3s 内第二次才 `finish()`（可选；或直接忽略，防止误退） |
| 方向键 | 办公室/面板 | 交给网页焦点环/列表滚动（契约：网页自己维护焦点） |
| MENU | 可选 | 打开设置/退出菜单（很多遥控没有，仅作锦上添花） |
| MEDIA_PLAY_PAUSE | 可选 | 暂停/继续动画，或打断 TTS |
| VOICE_ASSIST | 不可用 | 系统消费（见 7.1），不要试图拦截 |

---

## 5. 渲染方案对比与选型

### 5.1 候选方案对比

| 维度 | **A. 原生 SurfaceView + Canvas（Kotlin）** | **B. WebView（HTML Canvas）** | C. GLES / LibGDX | D. Godot / Unity / Cocos |
|---|---|---|---|---|
| APK 大小 | **< 1~3 MB**（纯代码+像素图） | +0（页面在 Mac 上）/+1-3 MB（打包进 APK） | LibGDX ~3-6 MB | 20-80 MB（引擎运行时） |
| 运行时 RAM | **低（< 80-150 MB）** | 中高（**150-300 MB**，老 WebView 更差） | 中 | **高（200-400 MB）** |
| 便宜盒子 1080p 30fps | **轻松**（低分辨率离屏 canvas 放大，CPU/GPU 都省） | 一般：1080p Canvas2D 在 S905/老 Chromium 上偏吃力，需降渲染分辨率 | 轻松（GLES2.0/Mali-450 够） | 吃力（1 GB RAM 盒子易卡/被杀） |
| 60fps | 可（降分辨率/简化特效） | 勉强（1080p 全屏 Canvas2D 很难稳 60） | 可 | 视场景 |
| 长跑稳定性（几小时） | **最好**（无 GC/JS 引擎，自己控制内存） | 差（Chromium 内存增长、JS GC 抖动、老版本泄漏） | 好 | 中（引擎自身泄漏/升温） |
| 开发速度 | 中（要写渲染代码） | **最快**（复用 Mac 网页原型、热调试） | 中 | 快（编辑器强） |
| 与现有 bridge/网页复用 | 低（要移植渲染） | **最高**（契约 v1 就是这路线） | 低 | 低 |
| 依赖网络 | **不需要**（可离线） | 需要（Mac bridge 在局域网/或打包本地页面） | 不需要 | 不需要 |
| 按键/TTS/录音集成 | **最顺**（同进程原生） | 需 JS 桥（契约已设计） | 中 | 中（要写插件） |
| 老盒子兼容风险 | 低（API 21 起都支持 Canvas） | **高**：老 WebView（Android 5/6 盒子是 Chromium 37~55，可能不支持现代 JS；部分魔改 ROM 甚至没有可用 WebView） | 低-中（GLES2 都支持） | 高（体积/性能） |

### 5.2 硬件基线（为什么不能按旗舰机设计）

Amlogic 主流盒子芯片（[Wikipedia: Amlogic](https://en.wikipedia.org/wiki/Amlogic)）：

- **S905**：4×Cortex-A53 + **Mali-450 MP3 @750MHz**，1/2 GB RAM，Android 5.1~7.1；
- **S905X**：同 S905 加 VP9/HDR/HDMI2.0a，4K 解码；
- **S905W/L**：阉割版（4K30/无 VP9），低价盒子常见；
- 新一点的 **S905X4/S922X**（A55/A73 + Mali-G31/G52）性能好很多，但本项目要覆盖的是“老 S905 + 1 GB RAM + Android 7”这批。

像素办公室 + 鲸鱼娘是**大量小精灵 + 少量特效**，瓶颈在：①每帧全屏重绘 ②内存带宽（1 GB 盒子）③WebView 的 Chromium 开销。所以原则是：**降低渲染分辨率（如 480×270 或 640×360 离屏，最近邻放大到 1080p）**，而不是硬刚 1920×1080 逐帧 Canvas2D。

### 5.3 本项目建议（与冻结契约对齐）

**v1（当前契约）＝ B. WebView 瘦客户端。** 理由（真实、不粉饰）：

1. 契约已经把 Mac 上的像素办公室网页 `/tv` 作为唯一渲染源，APK 只做“壳”；
2. 开发速度最快，办公室/鲸鱼娘素材与交互都在网页侧迭代，**不用为 Android 重新打包美术**；
3. 鲸鱼娘素材来自 webp 帧服务（Mac 提供），APK 不用带几十 MB 素材；
4. 长按/TTS/keep-screen-on 这些原生能力在壳里实现，网页专注表现。

**但 v1 必须做下面 4 项硬化，否则在便宜盒子上会翻车：**

| # | 风险 | 硬化措施 |
|---|---|---|
| 1 | 老 WebView（Android 5/6 盒子 Chromium 很老，现代 JS 语法直接白屏） | ① 启动时 `navigator.userAgent` 打日志；② 网页 JS **转译到 ES2015**（esbuild/tsc target 老一点），不要用顶层 `await`、可选链等新语法；③ 检测 `WebView.getCurrentWebViewPackage()`（API 26+）或 UA 里的 Chrome 版本，太老就提示“设备浏览器太旧”，并保留降级静态图 |
| 2 | 1080p Canvas / webp 帧 + DOM 动画在 S905 上掉帧 | ① 渲染按 `window.devicePixelRatio`/实际分辨率**内部降采样**（canvas 640×360 再 CSS 放大）；② 限制同时播放的帧数，静止时降帧；③ 关掉不必要的 CSS filter/box-shadow/大面积透明度 |
| 3 | 长跑内存增长 / WebView 泄漏 | ① 页面每 30~60 分钟自动 `location.reload()`（办公室状态会重新拉 `/api/state`，成本低）；② 原生侧 `onTrimMemory` 时清理 WebView 缓存；③ `webView.clearCache(false)` 定期；④ 监控 `adb shell dumpsys meminfo` 看 PSS |
| 4 | Mac 没开/断网 → 白屏 | 契约已定：本地错误页 + 每 5s 重试 + `am start --es url` 覆盖；**不允许白屏/崩溃**（这是小孩场景的底线） |

**终局建议（v2，若观察到大面积掉帧/被杀/白屏投诉）＝ A. 原生 SurfaceView + Canvas。** 迁移成本可控：把网页的“精灵表 JSON + 渲染逻辑”照搬，素材（webp/png 帧）打进 `assets/`；心跳、聊天、TTS 仍走 bridge HTTP API（原生 `OkHttp`/`HttpURLConnection`），不需要重写业务。收益：APK < 3 MB、RAM < 100 MB、离线可跑、没有 WebView 版本地狱。

**不推荐 C/D：** LibGDX 对“静态像素场景 + 大量 Android 原生 UI（聊天面板要输入框/列表）”是过度设计；Godot/Unity 的 APK 体积与内存对 1 GB 盒子不友好，且本项目没有 3D/物理/复杂特效需求。

### 5.4 如果切原生：SurfaceView 渲染骨架（Kotlin）

```kotlin
class OfficeSurfaceView(context: Context) : SurfaceView(context), SurfaceHolder.Callback, Runnable {

    private var thread: Thread? = null
    @Volatile private var running = false

    // 低分辨率离屏画布：480x270，最近邻放大到 1080p（像素风正合适，CPU/内存都省）
    private val offscreen = Bitmap.createBitmap(480, 270, Bitmap.Config.RGB_565)
    private val offCanvas = Canvas(offscreen)
    private val upscalePaint = Paint().apply { isFilterBitmap = false; isAntiAlias = false }
    private val dst = Rect()

    init { holder.addCallback(this); isFocusable = false }

    override fun surfaceCreated(h: SurfaceHolder) = start()
    override fun surfaceDestroyed(h: SurfaceHolder) = stop()
    override fun surfaceChanged(h: SurfaceHolder, format: Int, w: Int, hgt: Int) {
        dst.set(0, 0, w, hgt)         // 全屏拉伸；像素风用最近邻
    }

    private fun start() {
        if (thread != null) return
        running = true
        thread = Thread(this, "office-render").also { it.start() }
    }

    private fun stop() {
        running = false
        thread?.join(800); thread = null
    }

    override fun run() {
        val frameNs = 33_333_333L            // 30fps 足够；省电、省 CPU
        var last = System.nanoTime()
        while (running) {
            val now = System.nanoTime()
            val wait = frameNs - (now - last)
            if (wait > 0) { Thread.sleep(wait / 1_000_000, (wait % 1_000_000).toInt()) ; continue }
            last = now
            offCanvas.drawColor(0xFF10151F.toInt())
            // drawFloor(offCanvas); drawDesk(offCanvas); drawWhaleGirl(offCanvas); drawHud(offCanvas)
            val c = holder.lockCanvas() ?: continue
            try { c.drawBitmap(offscreen, null, dst, upscalePaint) } finally { holder.unlockCanvasAndPost(c) }
        }
    }
}
```

> 关键：**渲染线程独立**、**绘制低分辨率离屏**、**最近邻放大**（`isFilterBitmap=false`，像素风不糊）、**主循环零分配**（Paint/Rect/Bitmap 全部预分配，不在 loop 里 new）。若以后要更炫的光照/粒子，再换 `GLSurfaceView`（GLES 2.0），Mali-450 也扛得住。

### 5.5 长时间运行稳定性（小孩会开着几小时）

| 风险 | 措施 |
|---|---|
| 盒子/电视屏保、自动休眠 | `FLAG_KEEP_SCREEN_ON`（Activity 级）；必要时再加 `View.setKeepScreenOn(true)`。注意：`FLAG_KEEP_SCREEN_ON` 在盒子进入待机/HDMI 断开时无效，属正常 |
| 内存泄漏（Activity/线程/Handler） | 渲染 Thread 用 `surfaceDestroyed` 停；Handler 用静态内部类或移除 callback；WebView 在 `onDestroy` 里 `loadUrl("about:blank")` + `destroy()`；不把 Activity 存静态 |
| 大图 OOM（1 GB 盒子） | 素材用 RGB_565（像素画不损失观感）、`inScaled=false`、`filter=false`、精灵表（避免大量小 Bitmap 对象）；不要 `Bitmap.createScaledBitmap` 每帧 |
| 掉帧/发热 | 30fps 上限、静止时降帧（帧差检测）、避免全屏 alpha 混合层叠 |
| **烧屏**（OLED 电视） | 静止 UI 别用纯白大面积；每 1~2 分钟整体像素位移 ±2px；夜间模式调暗；空闲 5~10 分钟自动进“睡眠/星空”低亮度场景 |
| 系统杀进程（低内存盒子） | 保持前台 Activity，不做后台服务；`onTrimMemory` 释放缓存；崩溃后 `adb` 侧有看门狗（原型阶段不做自拉起） |
| 分辨率切换（1080p↔4K） | `configChanges` 拦住重建；SurfaceView 在 `surfaceChanged` 里重算 `dst`；WebView 方案靠 CSS 自适应 |
| 音频/TTS 焦点 | 以后加语音时用 `AudioManager` 请求 `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`，TTS 用 `USAGE_ASSISTANT` 音频属性 |

---

## 6. 中文 TTS（电视盒子上的现实）

### 6.1 系统 TTS 的现实

- `android.speech.tts.TextToSpeech` 需要设备上**装了一个 TTS 引擎**（实现 `android.intent.action.TTS_SERVICE` 的服务）。`TextToSpeech(context, listener)` 初始化失败会回调 `ERROR`；`getEngines()` 可能是空列表；`getDefaultEngine()` 可能为 null。
- **便宜国产盒子（无 GMS）经常没有中文 TTS 引擎**：Google TTS 不会预装；部分盒子带厂商语音（思必驰/讯飞/阿里）但**只给自己的助手用**，不注册成系统 TTS。表现：初始化失败、或 `setLanguage(Locale.CHINA)` 返回 `LANG_MISSING_DATA / LANG_NOT_SUPPORTED`。这条是社区与实机常见现象，**具体机型需实测**（本机无真机，无法验证）。
- 官方 API 依据：[TextToSpeech](https://developer.android.com/reference/android/speech/tts/TextToSpeech)（含 targetSdk ≥ 30 必须在 `<queries>` 声明 `TTS_SERVICE`）。

检测代码（建议启动时跑一次并打日志，不要弹窗吓用户）：

```kotlin
private var tts: TextToSpeech? = null

private fun initTts() {
    tts = TextToSpeech(this) { status ->
        if (status != TextToSpeech.SUCCESS) {
            Log.w("DshTv", "TTS init failed, status=$status")   // 常见于无引擎的盒子
            return@TextToSpeech
        }
        val r = tts!!.setLanguage(Locale.SIMPLIFIED_CHINESE)
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
            Log.w("DshTv", "no zh voice; engines=" + tts!!.engines.map { it.name })
            tts!!.shutdown(); tts = null
            return@TextToSpeech
        }
        tts!!.setSpeechRate(0.95f)    // 给小孩稍慢一点
        tts!!.setPitch(1.12f)         // 鲸鱼娘：略高、可爱
    }
}

fun speak(text: String) {
    val t = tts ?: return
    t.speak(text, TextToSpeech.QUEUE_FLUSH, null, "line-${System.nanoTime()}")
}
```

### 6.2 方案对比

| 方案 | 音质/童声 | 离线 | 延迟 | 体积/成本 | 可靠性（国产盒子） | 结论 |
|---|---|---|---|---|---|---|
| A. 系统 `TextToSpeech` | 看盒子（常常没有/机械音） | ✅ | 低 | 0 | **低**（引擎缺失） | v1 用它，失败静默降级 |
| B. 预生成固定台词音频（WAV/Opus 打进 APK 或 Mac 提供） | 可控（可做童声/鲸鱼娘音色） | ✅ | **0** | 几 MB（Opus 24~32 kbps，100 句≈1 MB） | **最高** | **主路径（固定台词）** |
| C. 云 TTS（Azure / 火山引擎 / 阿里云 / 腾讯云 / 讯飞 / OpenAI 等） | **最好**（可选童声/多音色） | ❌ 需网 | 300~1000 ms | 按量计费；key 必须放服务端代理 | 中（依赖网络与代理） | **主路径（动态回复）** |
| D. 内置离线引擎 sherpa-onnx（VITS 中文） | 好（神经网络） | ✅ | 中（CPU 推理） | **中文 APK 约 45 MB（aishell3）~131 MB（eula 音色）**；也可只打运行时、模型首次联网下载 | 中高（arm64/armv7 需同时打） | 无网兜底/隐私场景可选 |
| E. 让用户装一个“TTS 引擎 APK”（sherpa-onnx TTS Engine） | 好 | ✅ | 中 | 用户侧安装 | 中（多一步、需允许未知来源） | 可作为“语音包”可选项，不适合默认 |

依据：[sherpa-onnx TTS APK 列表](https://k2-fsa.github.io/sherpa/onnx/tts/apk.html)（含 `zh` 模型）、[TTS Engine APK](https://k2-fsa.github.io/sherpa/onnx/tts/apk-engine.html)。实测 APK 体积（arm64-v8a，2026-11 拉取）：`zh-tts-vits-icefall-zh-aishell3` ≈ **45.4 MB**，`zh-tts-vits-zh-hf-eula` ≈ **131.0 MB**。

### 6.3 推荐策略（分层）

1. **固定台词（90% 的互动）→ 预生成音频**：戳一下的反应、常见问题、口头禅，构建期用云 TTS 批量生成 Opus/WAV，打进 APK 或由 Mac bridge 提供。**零延迟、离线、免费、音色统一**。
2. **动态回复（聊天内容）→ 云 TTS，但 key 放服务端**：APK 里不存 API key；由 Mac bridge（或以后的云函数）代调 TTS，把音频流/URL 返回给电视。**不要**把云厂商 key 写进 APK（反编译即泄露）。
3. **系统 TTS 仅作“有就用”**：v1 契约要求 `TextToSpeech(Locale.CHINA)`，失败只打日志——符合预期，不要把它当主路径。
4. **可选离线补丁**：如果目标用户有“断网也要说话”的硬需求，再评估 sherpa-onnx（APK +40 MB 量级，或首次启动下载模型到 `filesDir`）。

> 补充：DeepSeek 官方 API 目前提供的是文本/推理能力，**没有官方 TTS/ASR 端点**（截至本报告，需以官方文档为准）；所以“鲸鱼娘说话”要另接 TTS 供应商。

### 6.4 其它要点

- 音频焦点：`AudioAttributes` 用 `USAGE_ASSISTANT`（API 21+ `TextToSpeech.setAudioAttributes`），播报前请求 `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`。
- 打断：新的用户输入到达时 `QUEUE_FLUSH`（契约要求）。
- 字幕：网页端**必须同时显示文字**（很多电视音量小/静音，且小孩识字阶段需要）。
- 退出时 `tts.shutdown()`，否则引擎服务泄漏。

---

## 7. 语音输入（现实约束，不是愿望）

### 7.1 遥控器 mic 键的真相（有官方文档证据）

- Android TV 遥控器的麦克风键，按下后**由系统/厂商语音助手接管**。官方 TV 导航文档写得很直白：
  > **Microphone button**: Invokes either Google Assistant or voice input.
  —— [TV navigation](https://developer.android.com/training/tv/get-started/navigation)
- 对应键值 `KEYCODE_VOICE_ASSIST = 231`，官方 API 文档原文：
  > Key code constant: Voice Assist key. **Launches the global voice assist activity. Not delivered to applications.**
  —— [KeyEvent#KEYCODE_VOICE_ASSIST](https://developer.android.com/reference/android/view/KeyEvent#KEYCODE_VOICE_ASSIST)
- 含义：**普通第三方 App 收不到这个键，也拿不到遥控器麦克风的音频**。认证 Google TV/Android TV 上被 Google 助理消费；国产盒子上被小爱/天猫精灵/当贝/夏杰语音等厂商助手消费（很多还是厂商 BLE 遥控私有协议，Mic 音频直通厂商服务）。
- 另外，TV 硬件特性里**麦克风本身是“不支持的硬件特性”**（`android.hardware.microphone` 对 TV 不是标配）：
  > TVs … don't have hardware features … the following features are not supported for a TV device: … **Microphone** (`android.hardware.microphone`) … Note: Some TV controllers have a microphone, which is not the same as the microphone hardware feature described here. **The controller microphone is fully supported.**
  —— [Handle TV hardware](https://developer.android.com/training/tv/get-started/hardware)

  “fully supported”指的是**系统语音输入**（助手/输入法），不是给普通 App 录音。

### 7.2 `RecognizerIntent` / `SpeechRecognizer` 的现实

- `SpeechRecognizer` / `ACTION_RECOGNIZE_SPEECH` 需要设备上有一个 **`RecognitionService` 实现**（通常是 Google App）。`isRecognitionAvailable()` 在国产盒子上大概率返回 `false`；`startActivity(RecognizerIntent)` 可能 `ActivityNotFoundException`。
- 即便可用：它走的是“系统识别 UI + 系统权限”，**不是我们 App 的录音**；识别的音频我们拿不到，也没法做流式/自定义。
- `RECORD_AUDIO` + `AudioRecord`：只有当系统里存在**对 App 可见的麦克风设备**时才有效。遥控器麦克风不是系统麦克风 → 录不到。
- 国产盒子上的厂商 ASR（讯飞/思必驰等）通常是**预装的私有 SDK/服务**，不注册成 `RecognitionService`，第三方 App 用不了（拿不到授权/签名）。

### 7.3 可行方案对比（真正能做的）

| 方案 | 可行性 | 硬件要求 | 体验 | 成本/复杂度 | 结论 |
|---|---|---|---|---|---|
| **A. USB 麦克风 / USB 声卡 + `AudioRecord` 16 kHz PCM** | **高**（盒子有 USB Host 即可，绝大多数有） | USB 麦（几十元）或 USB 声卡+3.5mm 麦 | 好（固定位置、免配对） | 中（录音 + VAD + 云 ASR 流式） | **推荐 v2 主路线** |
| **B. 手机当麦克风（companion App / 扫码配对，WebSocket 推 PCM）** | **最高**（手机麦克风好、权限好拿、无需盒子硬件） | 一台旧手机/平板 | 很好（还能当遥控/键盘输入） | 中高（多一个 App + 配对） | **推荐备选/增强**（对小孩可用“固定放电视旁”解决） |
| C. 蓝牙麦克风/蓝牙音箱麦 | 低 | 蓝牙麦 | 差 | — | **不推荐**：TV/盒子 A2DP 只有输出，HFP/SCO 输入支持普遍很差 |
| D. USB 摄像头（UVC）自带麦 | 中（取决于盒子 UVC + 音频路由） | UVC 摄像头 | 中 | 低 | 可试，**不确定** |
| E. 直接复用遥控器 mic | **不可行**（7.1） | — | — | — | **放弃** |
| F. 系统 `SpeechRecognizer` | 低（国产盒子无服务） | — | 中（系统 UI） | 低 | 只做“有就用”的降级 |

**云端 ASR**：16 kHz/16-bit/单声道 PCM，WebSocket 流式（讯飞 RTASR、阿里云、腾讯云、火山引擎等），带 VAD 断句；端到端延迟约 300~800 ms（看网络）。**离线 ASR**：sherpa-onnx 的流式中文 zipformer 模型可在 arm64 盒子本地跑，适合无网/隐私场景，但模型体积与算力要评估（首版不做）。

### 7.4 推荐分阶段路线

1. **v1（当前契约）**：不做语音。长按 OK → 文字聊天面板（网页输入框）；**电视端没有输入法/遥控打字很痛苦**，所以 v1 的聊天以“预设快捷问题（方向键选择）+ 鲸鱼娘朗读（TTS）”为主，语音留到 v2。
2. **v1.1**：加“手机扫码输入”——手机打开一个网页输入框，文字经 bridge 送到电视（不需要麦克风权限，成本最低，体验立竿见影）。
3. **v2**：USB 麦克风 + 云 ASR 流式；同时保留手机当麦的备选。
4. **v2.1（可选）**：sherpa-onnx 离线 ASR/TTS，做断网兜底。

> 文本输入的坑要提前说：**电视盒子通常没有软键盘/输入法**，`EditText` 在 TV 上弹不出键盘或没法用遥控操作。要么自带九宫格/字母键盘（遥控方向键选字母，工作量不小），要么走“手机输入/语音”。这也是为什么建议 v1 用“快捷问题选择”而不是自由打字。

---

## 8. 从零到电视上跑起来（实测过的命令）

### 8.1 环境准备（本机已验证）

```bash
export JAVA_HOME=/opt/homebrew/Cellar/openjdk@17/17.0.15/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

java -version            # 17.x
adb version              # 1.0.41+
ls "$ANDROID_HOME/platforms"        # 需要 android-35 或 android-36
ls "$ANDROID_HOME/build-tools"      # 需要 35.0.0 或 36.0.0
```

没有 `gradle` 命令不影响构建——用本机已缓存的发行版：

```bash
GRADLE=$(ls -d "$HOME"/.gradle/wrapper/dists/gradle-9.4.1-bin/*/gradle-9.4.1/bin/gradle | head -1)
"$GRADLE" --version     # Gradle 9.4.1
```

### 8.2 Gradle 工程（配置已实测）

`settings.gradle.kts`：

```kotlin
pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "DeepSeekOfficeTV"
include(":app")
```

根 `build.gradle.kts`：

```kotlin
plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.21" apply false
}
```

`app/build.gradle.kts`（**注意：这是实测能构建的版本组合**）：

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.dsh.office.tv"
    compileSdk = 35                    // 契约值；实测 36 也可

    defaultConfig {
        applicationId = "dev.dsh.office.tv"
        minSdk = 21                    // 契约值；推荐 23 起步（6.0+）
        targetSdk = 34                 // 契约值
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    sourceSets["main"].java.srcDir("src/main/kotlin")
}
```

生成 wrapper（本机没有 gradle 命令时用缓存发行版跑一次）：

```bash
cd deepseek-office-tv/tv-app
"$GRADLE" wrapper --gradle-version 9.4.1 --no-daemon
# 之后正常用 ./gradlew（首次会联网下载 9.4.1 发行包，约 130 MB；本机已缓存则可直接跑）
```

构建：

```bash
# 本会话沙箱必须设置（见 1.3）；正常开发机可省略这两行
export GRADLE_USER_HOME=/tmp/gradlehome ANDROID_USER_HOME=/tmp/androidhome

./gradlew :app:assembleDebug
# 或没有 gradlew 时：
"$GRADLE" :app:assembleDebug

# 产物
ls -lh app/build/outputs/apk/debug/app-debug.apk
```

> 实测：`compileSdk=35 / minSdk=21 / targetSdk=34 / dev.dsh.office.tv` 这套**离线构建成功**，APK 约 858 KB（Kotlin 空壳）。AGP 8.13.2 与 Gradle 9.4.1 组合会产生 “Deprecated Gradle features … incompatible with Gradle 10” 的警告，不影响使用；想更稳可以把 wrapper 固定到 Gradle 8.13（AGP 8.13 的最低要求），但本机未缓存，需联网下载。

### 8.3 备用方案：完全不用 Gradle 的最小 APK（已实测可用）

适用于“CI 冒烟 / 环境彻底没 Gradle / 只想验证 manifest 能不能装”。本机实测步骤（产出 2,689 B 的签名 APK）：

```bash
SDK="$HOME/Library/Android/sdk"
BT="$SDK/build-tools/36.0.0"
PLATFORM="$SDK/platforms/android-36/android.jar"
cd /tmp/manual && mkdir -p build/gen build/classes build/dex

# 1) 资源编译 + 链接 + 生成 R.java
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/base.apk -I "$PLATFORM" \
  --manifest AndroidManifest.xml -R build/res.zip --java build/gen --auto-add-overlay

# 2) javac（纯 Java 版；Kotlin 版用 kotlinc 并额外把 kotlin-stdlib 打进 classpath）
javac -source 8 -target 8 -bootclasspath "$PLATFORM" -classpath "$PLATFORM" \
  -d build/classes $(find src build/gen -name '*.java')

# 3) dex
"$BT/d8" --lib "$PLATFORM" --min-api 23 --output build/dex $(find build/classes -name '*.class')

# 4) 把 classes.dex 塞进 APK
cp build/base.apk build/app-unsigned.apk
(cd build/dex && zip -q ../app-unsigned.apk classes.dex)

# 5) 对齐 + 签名（debug keystore）
"$BT/zipalign" -f -p 4 build/app-unsigned.apk build/app-aligned.apk
"$BT/apksigner" sign --ks "$HOME/.android/debug.keystore" \
  --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android \
  --out build/app-debug.apk build/app-aligned.apk

# 6) 校验
"$BT/apksigner" verify --verbose build/app-debug.apk   # v1/v2/v3 = true
"$BT/aapt2" dump badging build/app-debug.apk | head    # 看到 leanback-launchable-activity
```

**值不值得？** 只适合冒烟/教学：没有资源多版本、没有 R8/lint、依赖要手动管、Kotlin 要自己带 stdlib。**正式开发不要用**，用 Gradle；把上面的脚本留作“环境全崩时的验证手段”。

### 8.4 完整 checklist：从零到电视上跑起来

| # | 步骤 | 命令/操作 | 验收标准 |
|---|---|---|---|
| 1 | 确认 JDK 17 + SDK + adb | `java -version`、`ls $ANDROID_HOME/platforms`、`adb version` | JDK 17、android-35/36、build-tools 35/36 存在 |
| 2 | 建 Gradle 工程（settings/root/app 三个文件 + Kotlin 源码） | 见 8.2 | `./gradlew :app:assembleDebug` 成功 |
| 3 | 写 Manifest（2.1） | `LEANBACK_LAUNCHER`+`LAUNCHER`、两个 uses-feature、banner、cleartext | `aapt2 dump badging` 里有 `leanback-launchable-activity`、`uses-feature-not-required` |
| 4 | 实现 `dispatchKeyEvent` 长按（4.3） | 短按 `ok`、长按 `long_ok`、BACK 关面板 | `adb shell input keyevent 23` / `--longpress 23` 行为正确 |
| 5 | 生成 debug APK | `./gradlew :app:assembleDebug` | `app/build/outputs/apk/debug/app-debug.apk` 存在 |
| 6 | 盒子开 ADB（3.1） | 设置 → 开发者选项 → ADB 调试 | `adb devices` 能看到设备 |
| 7 | 连盒子 | `adb connect <ip>:5555` | `adb devices -l` 显示 `<ip>:5555 device` |
| 8 | 装 APK | `adb install -r -d -g app-debug.apk` | 输出 `Success` |
| 9 | 启动 | `adb shell am start -n dev.dsh.office.tv/.MainActivity` | 电视上出现办公室画面（或错误重试页） |
| 10 | 截图验证 | `adb exec-out screencap -p > tv-shot.png` | 图片正常（不是黑屏/花屏） |
| 11 | 按键验证 | `adb shell input keyevent 23`、`--longpress 23`、`4`、`19/20/21/22` | 戳一下 / 开面板 / 关面板 / 焦点移动 |
| 12 | TTS 验证 | logcat 看 `TTS init failed` 或引擎列表 | 有引擎则能朗读；没有则静默不崩 |
| 13 | 长跑验证 | 挂 2 小时，期间 `adb shell dumpsys meminfo` | PSS 不持续增长；不死机/不白屏 |
| 14 | 断网/重连验证 | 停掉 bridge → 5s 内出现重试提示；恢复 → 自动回到办公室 | 符合契约 §6.5 |

### 8.5 本次未验证项（必须真机复核）

- **`adb install` + 截图 + 真遥控长按**：本机无设备、无 TV 模拟器镜像 → 未执行。命令已给出，预期行为已写明。
- 可选：装 Android TV 模拟器镜像验证 UI（需 `sdkmanager "system-images;android-34;android-tv;x86_64"` 或 arm64 对应包；本机 `system-images` 是外接卷软链，未确认有 TV 镜像，且下载体积大——建议直接用真盒子）。
- 各家盒子的 ADB/未知来源入口差异：3.2 已标注，需按实际机型补。

---

## 9. 风险与不确定项（诚实清单）

| # | 事项 | 影响 | 建议 |
|---|---|---|---|
| 1 | 天猫魔盒/运营商盒子可能**完全禁止侧载/ADB** | 无法安装 | 首发不承诺这些机型；先支持 Amlogic 外贸盒子/当贝/小米，拿到真机再逐个适配 |
| 2 | 老盒子 **WebView 版本过旧/缺失** | v1 白屏 | 启动检测 UA/WebView 包版本；JS 转译 ES2015；准备“原生渲染”Plan B |
| 3 | 遥控器 **重复事件行为不一**（有无 repeat） | 长按不触发 | 已用自建计时器规避；仍建议在 2~3 种遥控器上实测 |
| 4 | 盒子**没有中文 TTS 引擎** | 不朗读 | 预生成音频 + 云 TTS；系统 TTS 仅兜底 |
| 5 | 遥控器 **mic 键被系统/厂商助手独占** | 语音输入不可行 | 不做“遥控器语音”；走 USB 麦/手机麦 |
| 6 | 电视端**无输入法**，文本聊天难输入 | 聊天体验差 | v1 快捷问题 + 手机扫码输入；v2 语音 |
| 7 | 4K 电视 **overscan/安全区** | UI 被裁边 | 设计留 5% 安全区；页面用百分比布局，核心内容居中 |
| 8 | HDMI 切换/开机广告抢焦点 | 按键无响应 | `onWindowFocusChanged` 恢复焦点 + `onResume` requestFocus |
| 9 | 长时间运行内存增长 | 卡顿/被杀 | 定期 reload/降帧/清缓存；`dumpsys meminfo` 监控 |
| 10 | 云 TTS/ASR 的 **API key 泄露** | 被盗刷 | key 只放 Mac bridge/服务端，APK 不存 |
| 11 | Amlogic S905 只有 1 GB RAM 的机型 | WebView 可能 OOM | 渲染降采样；监控 PSS；必要时切原生 |
| 12 | 鲸鱼娘素材**版权/授权** | 法务风险 | 见 `research/ecosystem.md`：素材需授权或替换，与本文无关但必须遵守 |

---

## 10. 参考资料（官方文档 & 可信来源）

**Android TV**
- [Create and run a TV app（TV 入口/leanback/touchscreen/banner/minSdk）](https://developer.android.com/training/tv/get-started/create)
- [Handle TV hardware（不支持硬件清单、manifest 写法）](https://developer.android.com/training/tv/get-started/hardware)
- [Manage TV controllers（D-pad/确认/返回 键码映射、指针遥控）](https://developer.android.com/training/tv/get-started/controllers)
- [TV navigation（遥控器按键语义、焦点、返回）](https://developer.android.com/training/tv/get-started/navigation)
- [TV app quality（banner 320×180、minSdk ≤ 31、TV-ML/MT 等规则）](https://developer.android.com/docs/quality-guidelines/tv-app-quality)

**按键 / 焦点 / WebView**
- [KeyEvent reference（键值、startTracking、FLAG_LONG_PRESS、KEYCODE_VOICE_ASSIST）](https://developer.android.com/reference/android/view/KeyEvent)
- [KeyEvent#KEYCODE_VOICE_ASSIST（Not delivered to applications）](https://developer.android.com/reference/android/view/KeyEvent#KEYCODE_VOICE_ASSIST)
- [View reference（onKeyDown/onKeyLongPress/performLongClick）](https://developer.android.com/reference/android/view/View)
- [WebView reference](https://developer.android.com/reference/android/webkit/WebView)
- [PackageManager（FEATURE_LEANBACK / FEATURE_TOUCHSCREEN / FEATURE_MICROPHONE）](https://developer.android.com/reference/android/content/pm/PackageManager)

**TTS / 语音**
- [TextToSpeech reference（引擎/语言检测、queries）](https://developer.android.com/reference/android/speech/tts/TextToSpeech)
- [RecognizerIntent reference](https://developer.android.com/reference/android/speech/RecognizerIntent)
- [SpeechRecognizer reference（isRecognitionAvailable）](https://developer.android.com/reference/android/speech/SpeechRecognizer)
- [sherpa-onnx Android TTS APK（含中文模型）](https://k2-fsa.github.io/sherpa/onnx/tts/apk.html)
- [sherpa-onnx TTS Engine APK（实现系统 TTS 引擎）](https://k2-fsa.github.io/sherpa/onnx/tts/apk-engine.html)

**构建 / 安装 / 工具**
- [Build your app from the command line](https://developer.android.com/build/building-cmdline)
- [d8](https://developer.android.com/tools/d8)
- [apksigner](https://developer.android.com/tools/apksigner)
- [adb（connect / install / screencap / exec-out）](https://developer.android.com/tools/adb)

**硬件**
- [Amlogic SoC 规格（S905/S905X/S905W/S922X…）](https://en.wikipedia.org/wiki/Amlogic)

**AOSP 源码依据（本机拉取 `frameworks/base` 核实）**
- `core/java/android/view/KeyEvent.java`：`startTracking()`、`dispatch()` 长按逻辑、`isConfirmKey()`
- `core/java/android/view/View.java`：`onKeyDown()` 对 confirm 键调用 `checkForLongClick(ViewConfiguration.getLongPressTimeout())`

---

## 附：本报告实测命令的可复现记录（2026-11-10）

| 实验 | 关键命令 | 结果 |
|---|---|---|
| Gradle 可用性 | `~/.gradle/wrapper/dists/gradle-9.4.1-bin/*/gradle-9.4.1/bin/gradle --version` | `Gradle 9.4.1` |
| 首次构建（在线） | `…/gradle :app:assembleDebug --no-daemon` | 成功下载并 `BUILD SUCCESSFUL` |
| 离线构建 | `…/gradle :app:assembleDebug --offline --no-daemon` | `BUILD SUCCESSFUL`（缓存已热） |
| 契约版本组合 | compileSdk 35 / minSdk 21 / targetSdk 34 / `dev.dsh.office.tv` | `BUILD SUCCESSFUL`，APK 858,345 B |
| 无 Gradle | 见 8.3 | 2,689 B 签名 APK；v1/v2/v3 验签通过 |
| 沙箱坑 | 默认 `~/.gradle` / `~/.android` | 可复现的 `Operation not permitted`；按 1.3 设置后正常 |
| 真机 | `adb devices` | 空（无设备）→ 安装/截图未验证 |

> 报告结束。后续若 Lead 决定切原生渲染，可直接以 5.4 的骨架 + 本文档第 4 节按键实现为起点；若要继续 WebView 路线，请让 tv-app-builder 先按 5.3 的硬化清单实现启动检测与错误页。
