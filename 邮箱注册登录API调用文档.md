# 弦予音乐 APP — 邮箱注册登录 API 调用文档

> 本文档供 APP 客户端开发接入使用，涵盖邮箱注册、登录、验证码、找回密码、修改密码等全部接口。

---

## 一、基础信息

| 项目 | 值 |
|---|---|
| API 基础地址 | `https://xymusic.zh2026.cn/api/` |
| 请求方式 | `POST` |
| Content-Type | `application/json` |
| action 传参 | URL Query：`?action=接口名` |
| 请求体 | JSON 字符串（UTF-8） |
| 响应格式 | JSON：`{"code": 200, "msg": "...", "data": {...}}` |
| API_SECRET | `bf027fedb4d1b4f969c10495f12f17042bf0de02de128200` |
| 时间戳容差 | 300 秒（客户端与服务器时间差超过 5 分钟则验签失败） |

### 1.1 完整请求示例

```
POST https://xymusic.zh2026.cn/api/?action=register
Content-Type: application/json
X-Timestamp: 1700000000
X-Nonce: abc123def456
X-Sign: a1b2c3d4e5f6...

{"username":"张三","password":"123456","email":"test@example.com","verify_code":"123456"}
```

### 1.2 响应格式

```json
{
    "code": 200,
    "msg": "成功",
    "data": { ... }
}
```

| code | 含义 |
|---|---|
| 200 | 成功 |
| 400 | 参数错误 / 业务校验失败 |
| 401 | 未授权 / 凭证错误 |
| 403 | 禁止访问 / 账号禁用 / 签名失败 |
| 404 | 资源不存在 |
| 429 | 请求过于频繁 |
| 500 | 服务器错误 |

> HTTP 状态码与 JSON code 保持一致（4xx/5xx 时 HTTP 状态码同步设置）。

---

## 二、签名算法（必读）

除白名单接口外，**所有接口都需要签名验证**，否则返回 `403 签名验证失败`。

### 2.1 请求头

| Header | 说明 |
|---|---|
| `X-Timestamp` | 当前 Unix 时间戳（秒），与服务器时差 ≤ 300 秒 |
| `X-Nonce` | 随机字符串（6-32 位，每次请求唯一） |
| `X-Sign` | 签名值（见下方算法） |

### 2.2 签名计算

```
sign = md5( timestamp + nonce + body + api_secret )
```

- `timestamp`：与 `X-Timestamp` 相同的字符串
- `nonce`：与 `X-Nonce` 相同的字符串
- `body`：原始请求体（JSON 字符串，即 POST 的 raw body）
- `api_secret`：`bf027fedb4d1b4f969c10495f12f17042bf0de02de128200`

### 2.3 各语言签名示例

**Java（Android）**：

```java
import java.security.MessageDigest;

public class ApiSign {
    public static String sign(String timestamp, String nonce, String body, String secret) throws Exception {
        String raw = timestamp + nonce + body + secret;
        MessageDigest md = MessageDigest.getInstance("MD5");
        byte[] digest = md.digest(raw.getBytes("UTF-8"));
        StringBuilder sb = new StringBuilder();
        for (byte b : digest) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}

// 调用
String body = "{\"username\":\"张三\",\"password\":\"123456\"}";
String timestamp = String.valueOf(System.currentTimeMillis() / 1000);
String nonce = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
String sign = ApiSign.sign(timestamp, nonce, body, "bf027fedb4d1b4f969c10495f12f17042bf0de02de128200");

// 设置请求头
Request request = new Request.Builder()
    .url("https://xymusic.zh2026.cn/api/?action=user_login")
    .post(RequestBody.create(body, MediaType.parse("application/json")))
    .addHeader("X-Timestamp", timestamp)
    .addHeader("X-Nonce", nonce)
    .addHeader("X-Sign", sign)
    .build();
```

**Kotlin（Android）**：

```kotlin
import java.security.MessageDigest

fun apiSign(timestamp: String, nonce: String, body: String, secret: String): String {
    val raw = "$timestamp$nonce$body$secret"
    val digest = MessageDigest.getInstance("MD5").digest(raw.toByteArray(Charsets.UTF_8))
    return digest.joinToString("") { "%02x".format(it) }
}

// 调用
val body = """{"username":"张三","password":"123456"}"""
val timestamp = (System.currentTimeMillis() / 1000).toString()
val nonce = UUID.randomUUID().toString().replace("-", "").substring(0, 16)
val sign = apiSign(timestamp, nonce, body, "bf027fedb4d1b4f969c10495f12f17042bf0de02de128200")
```

**Dart（Flutter）**：

```dart
import 'dart:convert';
import 'package:crypto/crypto.dart';

String apiSign(String timestamp, String nonce, String body, String secret) {
  final raw = timestamp + nonce + body + secret;
  return md5.convert(utf8.encode(raw)).toString();
}

// 调用
final body = jsonEncode({"username": "张三", "password": "123456"});
final timestamp = (DateTime.now().millisecondsSinceEpoch ~/ 1000).toString();
final nonce = DateTime.now().microsecondsSinceEpoch.toRadixString(16);
final sign = apiSign(timestamp, nonce, body, "bf027fedb4d1b4f969c10495f12f17042bf0de02de128200");
```

### 2.4 可选：加密传输

如果需要加密请求/响应（防止中间人抓包），可使用 AES-256-CBC：

| Header | 说明 |
|---|---|
| `X-Encrypted-IV` | Base64 编码的 16 字节 IV，存在则表示请求体已加密 |

**加密流程**：
1. AES 密钥 = `SHA-256(api_secret)` → 32 字节
2. 生成 16 字节随机 IV
3. 用 AES-256-CBC 加密 JSON body，输出 Base64
4. 请求头设置 `X-Encrypted-IV: base64(iv)`
5. 签名基于**密文**（加密后的 Base64 字符串），不是明文

**响应解密**：
- 如果响应头有 `X-Encrypted-Response: 1`，则响应体是密文
- 用响应头 `X-Response-IV` 中的 IV 解密
- 同样用 `SHA-256(api_secret)` 作为密钥

> **注意**：签名始终基于实际发送的 body（加密时是密文，不加密时是明文 JSON）。

---

## 三、接口列表

### 3.1 发送邮箱验证码

> 用于注册、登录、找回密码三个场景，通过 `type` 参数区分。

```
POST /api/?action=send_verify_code
```

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `email` | string | 是 | 邮箱地址 |
| `type` | string | 否 | 场景类型：`register`（注册，默认）/ `login`（登录）/ `reset_password`（找回密码） |

**请求示例**：

```json
{
    "email": "user@example.com",
    "type": "register"
}
```

**成功响应**：

```json
{
    "code": 200,
    "msg": "验证码已发送"
}
```

**频率限制**：

| 限制 | 规则 |
|---|---|
| 同一邮箱 | 60 秒内只能发 1 次 |
| 同一 IP | 每小时最多 10 次 |

**验证码有效期**：10 分钟

**错误码**：

| code | msg |
|---|---|
| 400 | 邮箱格式不正确 |
| 429 | 发送过于频繁，请1分钟后再试 |
| 429 | 请求过于频繁，请稍后再试 |
| 500 | 邮件发送失败：... |

**发件邮箱**：`admin@bzxhkj.com`

---

### 3.2 用户注册

```
POST /api/?action=register
```

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `username` | string | 是 | 用户名（2-32 字符） |
| `password` | string | 是 | 密码（至少 6 位） |
| `email` | string | 是 | 邮箱地址 |
| `verify_code` | string | 是 | 邮箱验证码（type=register） |

**请求示例**：

```json
{
    "username": "张三",
    "password": "myPassword123",
    "email": "user@example.com",
    "verify_code": "123456"
}
```

**成功响应**：

```json
{
    "code": 200,
    "msg": "注册成功",
    "data": {
        "user_id": "1",
        "username": "张三",
        "ciyuanxi_id": "1000"
    }
}
```

**错误码**：

| code | msg |
|---|---|
| 400 | 用户名长度需2-32个字符 |
| 400 | 密码长度至少6位 |
| 400 | 邮箱格式不正确 |
| 400 | 请输入验证码 |
| 400 | 验证码无效或已过期 |
| 400 | 用户名已存在 |
| 400 | 该邮箱已注册 |
| 400 | 该邮箱已被使用（与管理员重复） |

> 注册成功后自动生成 12 位「弦予号」（唯一数字 ID），无需额外申请。

---

### 3.3 密码登录

> 支持用户名、邮箱、弦予号三种凭据登录，同一个输入框即可。

```
POST /api/?action=user_login
```

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `username` | string | 是 | 用户名 / 邮箱 / 弦予号（三选一） |
| `password` | string | 是 | 密码 |

**请求示例**：

```json
{
    "username": "user@example.com",
    "password": "myPassword123"
}
```

**成功响应**：

```json
{
    "code": 200,
    "msg": "登录成功",
    "data": {
        "user_id": "1",
        "username": "张三",
        "email": "user@example.com",
        "token": "a1b2c3d4e5f6...（64位hex）",
        "role": "",
        "avatar_url": "",
        "ciyuanxi_id": "1000",
        "is_pretty_id": 0,
        "listen_duration": 0,
        "unique_songs_count": 0,
        "master_quota": 200,
        "status": "enabled"
    }
}
```

**字段说明**：

| 字段 | 说明 |
|---|---|
| `token` | 登录令牌（64 位 hex），后续需登录的接口请保存并携带 |
| `role` | 角色：空字符串=普通用户，`admin`=管理员，`super_admin`=超级管理员 |
| `ciyuanxi_id` | 弦予号（12 位数字） |
| `is_pretty_id` | 是否为靓号：0=普通，1=靓号 |
| `master_quota` | 房主剩余配额 |
| `status` | 账号状态：`enabled`=正常，`disabled`=禁用 |

**错误码**：

| code | msg |
|---|---|
| 400 | 用户名和密码不能为空 |
| 401 | 用户名或密码错误 |
| 403 | 账号已被禁用，请联系管理员 |

---

### 3.4 验证码登录

> 免密登录，仅凭邮箱 + 验证码即可。

```
POST /api/?action=login_by_code
```

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `email` | string | 是 | 邮箱地址 |
| `verify_code` | string | 是 | 邮箱验证码（type=login） |

**请求示例**：

```json
{
    "email": "user@example.com",
    "verify_code": "123456"
}
```

**成功响应**：

```json
{
    "code": 200,
    "msg": "登录成功",
    "data": {
        "user_id": "1",
        "username": "张三",
        "email": "user@example.com",
        "token": "a1b2c3d4e5f6...",
        "role": "",
        "avatar_url": "",
        "ciyuanxi_id": "1000",
        "master_quota": 200,
        "status": "enabled"
    }
}
```

**错误码**：

| code | msg |
|---|---|
| 400 | 请输入正确的邮箱 |
| 400 | 请输入验证码 |
| 400 | 验证码无效或已过期 |
| 401 | 该邮箱未注册 |
| 403 | 账号已被禁用，请联系管理员 |

---

### 3.5 找回密码（重置密码）

```
POST /api/?action=reset_password
```

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `email` | string | 是 | 注册邮箱 |
| `verify_code` | string | 是 | 邮箱验证码（type=reset_password） |
| `new_password` | string | 是 | 新密码（至少 6 位） |

**请求示例**：

```json
{
    "email": "user@example.com",
    "verify_code": "123456",
    "new_password": "newPassword456"
}
```

**成功响应**：

```json
{
    "code": 200,
    "msg": "密码修改成功"
}
```

**错误码**：

| code | msg |
|---|---|
| 400 | 邮箱格式不正确 |
| 400 | 请输入验证码 |
| 400 | 新密码长度至少6位 |
| 400 | 该邮箱未注册 |
| 400 | 验证码无效或已过期 |

---

### 3.6 修改密码（需登录）

> 需要用户已登录，提供旧密码验证。

```
POST /api/?action=change_password
```

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `ciyuanxi_id` | string | 是 | 弦予号（兼容旧版 `user_id` 字段） |
| `old_password` | string | 是 | 旧密码 |
| `new_password` | string | 是 | 新密码（至少 6 位） |

**请求示例**：

```json
{
    "ciyuanxi_id": "1000",
    "old_password": "oldPassword123",
    "new_password": "newPassword456"
}
```

**成功响应**：

```json
{
    "code": 200,
    "msg": "密码修改成功"
}
```

**错误码**：

| code | msg |
|---|---|
| 400 | 用户ID不能为空 |
| 400 | 密码不能为空 |
| 400 | 新密码长度至少6位 |
| 404 | 用户不存在 |
| 400 | 旧密码错误 |

---

### 3.7 检查用户名可用性

```
POST /api/?action=check_username
```

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `username` | string | 是 | 待检查的用户名 |
| `exclude_ciyuanxi_id` | string | 否 | 排除该弦予号（编辑资料时排除自己） |

**请求示例**：

```json
{
    "username": "张三",
    "exclude_ciyuanxi_id": "1000"
}
```

**成功响应**：

```json
{
    "code": 200,
    "msg": "ok",
    "data": {
        "available": true
    }
}
```

| data 字段 | 说明 |
|---|---|
| `available` | `true`=可用，`false`=已被占用 |

---

## 四、典型业务流程

### 4.1 注册流程

```
APP 端                              服务端
  │  用户输入邮箱                      │
  │ ──── POST send_verify_code ────→  │  发送验证码邮件
  │ ←──── {"code":200,"msg":"已发送"} │
  │  用户填写用户名/密码/验证码         │
  │ ──── POST register ─────────────→ │  校验验证码 + 创建用户
  │ ←──── {"code":200,"data":{...}}   │  返回 user_id + ciyuanxi_id
  │  自动跳转登录                      │
```

### 4.2 登录流程（密码）

```
APP 端                              服务端
  │  用户输入用户名/邮箱/弦予号 + 密码  │
  │ ──── POST user_login ──────────→  │  OR 匹配三种凭据
  │ ←──── {"code":200,"data":{...}}   │  返回 token + 用户信息
  │  保存 token，进入首页              │
```

### 4.3 登录流程（验证码）

```
APP 端                              服务端
  │  用户输入邮箱                      │
  │ ──── POST send_verify_code ────→  │  type=login
  │ ←──── {"code":200}                │
  │  用户输入验证码                    │
  │ ──── POST login_by_code ────────→ │
  │ ←──── {"code":200,"data":{...}}   │  返回 token + 用户信息
```

### 4.4 找回密码流程

```
APP 端                              服务端
  │  用户输入注册邮箱                  │
  │ ──── POST send_verify_code ────→  │  type=reset_password
  │ ←──── {"code":200}                │
  │  用户输入验证码 + 新密码           │
  │ ──── POST reset_password ───────→ │  校验 + 更新密码
  │ ←──── {"code":200}                │
  │  跳转登录                          │
```

---

## 五、注意事项

1. **签名是必须的**：除 `install`/`check`/`get_source_status`/`upload_avatar` 等少数接口外，所有接口都需要签名。忘记签名会返回 `403 签名验证失败`。

2. **时间同步**：客户端时间必须与服务器时间差 ≤ 300 秒，否则验签失败。建议每次请求前校准时间。

3. **验证码类型**：`send_verify_code` 的 `type` 参数必须与后续接口匹配：
   - 注册 → `type=register` → 调用 `register`
   - 验证码登录 → `type=login` → 调用 `login_by_code`
   - 找回密码 → `type=reset_password` → 调用 `reset_password`

4. **验证码有效期**：10 分钟，且只能使用一次。

5. **token 管理**：登录返回的 `token` 请安全存储（如 SharedPreferences / Keychain），APP 重启后保持登录态。token 目前无过期时间，但用户在另一设备登录会生成新 token。

6. **密码安全**：
   - 密码传输依赖 HTTPS 加密通道
   - 服务端使用 bcrypt 存储，不会明文返回
   - APP 端不要在日志中打印密码

7. **HTTPS 必须**：生产环境强制 HTTPS，HTTP 请求会被 Nginx 重定向到 HTTPS。

8. **API_SECRET 保护**：`bf027fedb4d1b4f969c10495f12f17042bf0de02de128200` 是签名密钥，请编译进 APP（不要明文存于配置文件），建议通过 NDK/C++ 层存储或代码混淆。

---

## 六、调试技巧

### 6.1 签名调试接口

如果签名失败，可使用 `debug_sign` 接口（白名单，无需签名）查看服务器期望的签名值：

```
POST /api/?action=debug_sign
Content-Type: application/json

{"timestamp":"1700000000","nonce":"abc123","body":"{\"username\":\"test\"}"}
```

响应会返回服务器计算的签名值，方便对比客户端计算是否正确。

### 6.2 常见签名失败原因

| 原因 | 排查方法 |
|---|---|
| body 不一致 | 签名用的 body 必须与实际 POST 的 body **完全一致**（包括空格、顺序） |
| 时间戳过期 | 检查客户端时间是否准确 |
| secret 错误 | 确认使用的是 `bf027fedb4d1b4f969c10495f12f17042bf0de02de128200` |
| 编码问题 | body 必须是 UTF-8 编码，中文不能乱码 |
| nonce 为空 | nonce 不能为空字符串 |
