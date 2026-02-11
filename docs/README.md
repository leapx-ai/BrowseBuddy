# BrowseBuddy GitHub Pages 文档

这是 BrowseBuddy 浏览器扩展的官方网站，用于 Chrome Web Store 上架时提供公开可访问的隐私政策和权限说明页面。

## 页面结构

```
docs/
├── index.html          # 中文主页（产品介绍、权限说明、隐私政策摘要）
├── index_en.html       # 英文主页
├── privacy.html        # 中文隐私政策详细页面
├── privacy_en.html     # 英文隐私政策详细页面（可选）
├── permissions.html    # 中文权限详解页面
├── permissions_en.html # 英文权限详解页面（可选）
├── terms.html          # 中文使用条款页面
├── terms_en.html       # 英文使用条款页面（可选）
└── README.md           # 本文件
```

## 部署到 GitHub Pages

### 方法：使用 GitHub Pages 的 /docs 文件夹

1. **启用 GitHub Pages**
   - 打开你的 GitHub 仓库
   - 进入 Settings → Pages
   - Source 选择 "Deploy from a branch"
   - Branch 选择 "main"，文件夹选择 "/docs"
   - 点击 Save

2. **访问网站**
   - 部署完成后，你的网站将可通过以下地址访问：
   - `https://yourusername.github.io/browsebuddy/`
   - 例如：`https://johndoe.github.io/browsebuddy/`

### 更新网站内容

只需将修改后的文件推送到 main 分支的 docs 文件夹，GitHub Pages 会自动重新部署（通常需要 1-5 分钟）。

```bash
# 修改文件后
git add docs/
git commit -m "更新隐私政策"
git push origin main
```

## 自定义域名（可选）

如果你想使用自定义域名（如 `browsebuddy.example.com`）：

1. 在 `docs/` 文件夹中创建 `CNAME` 文件，内容为你的域名：
   ```
   browsebuddy.example.com
   ```

2. 在你的域名 DNS 设置中添加 CNAME 记录：
   - 主机记录：www 或 browsebuddy
   - 记录值：yourusername.github.io

3. 在 GitHub Pages 设置中配置自定义域名

## 内容更新指南

### 修改项目信息

在以下页面中搜索并替换占位符：

| 占位符 | 说明 | 位置 |
|--------|------|------|
| `yourusername` | 你的 GitHub 用户名 | 所有页面中的 GitHub 链接 |
| `liuzhaooo@outlook.com` | 联系邮箱 | privacy.html, terms.html |
| `liuzhaooo@outlook.com` | 支持邮箱 | terms.html |
| `Coming Soon to Chrome Web Store` | Chrome 商店状态 | index.html, index_en.html |

### 更新版本号

发布新版本时，需要更新以下位置：
- `index.html` 和 `index_en.html` 中的版本号
- `docs/README.md` 中的更新日期

### 添加 Chrome Web Store 链接

上架后，将以下位置的占位符链接替换为真实的 Chrome Web Store 链接：

```html
<!-- index.html 中的按钮 -->
<a href="#" class="btn btn-disabled">即将上架 Chrome 应用商店</a>
<!-- 替换为 -->
<a href="https://chrome.google.com/webstore/detail/xxxxxx" class="btn">安装到 Chrome</a>
```

## Chrome Web Store 上架所需信息

### 必需提供的公开 URL

在 Chrome Web Store 开发者后台填写以下信息：

- **隐私政策 URL**: `https://yourusername.github.io/browsebuddy/privacy.html`
- **网站 URL**: `https://yourusername.github.io/browsebuddy/`

### 权限声明（必填）

在 Chrome Web Store 上架时，需要在"隐私"部分提供以下说明：

```
本扩展请求以下权限：

1. history - 读取和删除浏览器历史记录（核心功能）
2. storage - 本地存储设置和黑名单数据
3. tabs - 获取当前标签页信息（添加当前页面到黑名单）
4. activeTab - 获取当前活动标签页权限
5. <all_urls> - 监控所有 URL 变更以实现黑名单实时保护
6. contextMenus - 添加右键菜单项（可选）

所有数据均在本地处理，不会上传至任何服务器。
详细说明：https://yourusername.github.io/browsebuddy/permissions.html
```

## 多语言支持

当前提供中文和英文版本：
- 中文用户将访问 `index.html`
- 英文用户将访问 `index_en.html`

页面右上角提供语言切换链接。

## 技术细节

- 纯静态 HTML/CSS，无需服务器端处理
- 响应式设计，支持移动设备
- 无外部依赖（除字体外）
- 符合 Chrome Web Store 要求

## 验证清单

在提交 Chrome Web Store 前，确认以下事项：

- [ ] 所有占位符已替换为真实信息
- [ ] GitHub Pages 已启用并能正常访问
- [ ] 隐私政策页面内容完整准确
- [ ] 权限说明页面详细清晰
- [ ] 中英文版本内容一致
- [ ] 所有链接可正常点击
- [ ] 页面在移动设备上显示正常

## 故障排除

### GitHub Pages 404 错误

1. 确认仓库是公开的（Private 仓库的 GitHub Pages 需要 Pro 账户）
2. 确认 Settings → Pages 中的配置正确
3. 确认文件已推送到正确的分支

### 页面样式丢失

GitHub Pages 使用 HTTPS，确保没有引用 HTTP 资源。

### 更新未生效

GitHub Pages 可能有缓存，等待 5-10 分钟后刷新页面，或添加 `?nocache=1` 参数。

## 许可证

本网站内容采用与 BrowseBuddy 扩展相同的开源许可证。
