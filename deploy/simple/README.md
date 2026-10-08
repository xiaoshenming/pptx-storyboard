# 单密码服务器部署

此方案适合少量老师在同一台服务器上使用。所有老师共用一个访问密码，也都能进入服务配置页面；请只把密码交给可信人员。项目仍保存在各自浏览器的 IndexedDB 中。换浏览器或清理浏览器数据后，需要重新导入 PPTX。服务器上的视频任务文件保留约两小时。

## 准备

服务器安装 Docker Engine 和 Docker Compose，准备指向服务器的域名，并开放 80、443 端口。Docker 构建需要联网下载 Bun 依赖、FFmpeg 和 Edge TTS。建议至少 8 核 CPU、16 GB 内存以及足够的视频临时磁盘空间。

复制 `.env.example` 为 `.env`，设置 `SITE_ADDRESS`、不少于 12 字符的 `APP_PASSWORD`，以及独立的、不少于 32 字符的 `APP_SESSION_SECRET`。可以用 `openssl rand -hex 32` 生成会话密钥。不要提交或分享 `.env`；在 Linux 上运行 `chmod 600 .env`。如客户已有 HTTPS 反向代理，可调整 `compose.yaml`，仅将应用端口绑定到服务器回环地址，并由现有代理转发。

## 启动

在此目录运行：

```sh
docker compose up -d --build
docker compose ps
```

打开 `https://<SITE_ADDRESS>/`，输入共享密码。首页“我的项目”右侧可退出登录。首次进入后，在首页配置讲稿和语音服务的密钥。密钥保存在 `storyboard_data` 卷中的 `service-config.json`，不会打进镜像。密码变更后运行 `docker compose up -d` 使应用重启，旧登录会话在重启后失效。

## 运维

查看日志：`docker compose logs -f app`。更新应用：替换源码后运行 `docker compose up -d --build`。备份 `storyboard_data` 卷和 `.env`，并妥善保管。数据库和多用户权限不在此版本范围内；浏览器项目需要老师自行导出备份。

## 本机 Linux 容器测试

本机使用 `compose.local.yaml`，直接映射到回环 HTTP 端口，不需要域名或 Caddy。创建独立的环境文件，填写 `APP_PASSWORD`、`APP_SESSION_SECRET`（至少 32 字符）和 `LOCAL_PORT`（默认 4173）。本机密码最低长度为 8 字符，服务器方案仍要求 12 字符。

```sh
docker compose --env-file /path/to/docker.env.local -f compose.local.yaml up -d --build --wait
```

打开 `http://127.0.0.1:4173/` 登录。数据保存在本机部署独立的 `storyboard_data` 卷中。使用相同主机和端口可继续读取浏览器已有项目；首次迁移服务配置时，需要将原 `service-config.json` 复制到容器的 `/data/service-config.json` 后重启应用。不要把包含密钥的文件打进镜像。
