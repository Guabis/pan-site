# -*- coding: utf-8 -*-
"""
pan-site 本地服务（server.py）
=====================================
纯 Python 标准库实现，零第三方依赖（http.server / subprocess / json）。

站点双模式：
- 完整模式（本地管理页）：运行本服务后访问 http://127.0.0.1:8917，
  前端探测 GET /api/health 成功即解锁全部管理功能
  （添加/编辑资源统一面板 + TMDB 搜索、站点配置、扫码登录、一键刷新）；
- 静态模式（GitHub Pages）：纯静态托管下仅提供浏览/搜索/详情/转存，
  管理入口全部隐藏，不依赖任何后端。

接口：
- GET /api/health：存活探测（前端据此区分完整/静态模式）。
- 静态文件服务：直接托管本站目录（index.html / css / js / data / 图片等）。
- POST /api/refresh：用 subprocess 调用 pan-sync/run_pipeline.py --config config.json
  执行「夸克同步（文件夹级）+ TMDB 刮削」流水线，完成后返回执行结果 JSON：
  { success, message, resource_count, scraped_ok, scraped_total, fetched, elapsed, error? }
- GET /api/match/search?title=xxx&year=yyyy：subprocess 调用 pan-sync/tmdb_search.py，
  返回 TMDB movie+tv 合并候选列表 JSON。
- POST /api/match/apply：body 为 { folder_path, title, year, poster, overview, rating,
  media_type }，读取 data/resources.json 按 folder_path 定位资源记录，置 matched=true
  并写回，返回更新后的记录。
- POST /api/update / POST /api/add：编辑 / 手动添加资源，写回 data/resources.json。
- GET/POST /api/config：读取 / 保存 pan-sync/config.json（多夸克账号等，仅存本地）。
- POST /api/qrcode/*：扫码登录夸克（仅本地）。

自动推送：/api/update、/api/add、/api/match/apply 写回 resources.json 后，
会自动 git commit + push 到 Guabis/pan-site（GitHub Pages 自动更新）；
网络不可达或未配置 remote 时本地保存仍成功，仅跳过推送并返回原因。

用法：
    python server.py [port]        # 默认端口 8917
    python server.py 8917
"""

import atexit
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SYNC_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "pan-sync"))
RUNNER = os.path.join(SYNC_DIR, "run_pipeline.py")
TMDB_SEARCHER = os.path.join(SYNC_DIR, "tmdb_search.py")
CONFIG_PATH = os.path.join(SYNC_DIR, "config.json")
RESOURCES_PATH = os.path.join(BASE_DIR, "data", "resources.json")
QRCODE_SCRIPT = os.path.join(SYNC_DIR, "qrcode_login.py")
QRCODE_PORT = 8927
QRCODE_BASE = "http://127.0.0.1:%d" % QRCODE_PORT
QRCODE_PROC = None           # 扫码守护子进程（main 启动时拉起）
DEFAULT_PORT = 8917
PIPELINE_TIMEOUT = 900  # 秒；同步 + 刮削可能较慢，放宽超时
MATCH_TIMEOUT = 30      # 秒；TMDB 候选搜索


def _ensure_qrcode_service():
    """确保扫码守护进程（qrcode_login.py --serve）已启动，返回是否就绪。"""
    global QRCODE_PROC
    if QRCODE_PROC is not None and QRCODE_PROC.poll() is None:
        return True
    if not os.path.isfile(QRCODE_SCRIPT):
        return False
    try:
        QRCODE_PROC = subprocess.Popen(
            [sys.executable, QRCODE_SCRIPT, "--serve",
             "--port", str(QRCODE_PORT), "--config", CONFIG_PATH],
            cwd=SYNC_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return False
    # 健康检查：最多等 2 秒
    for _ in range(8):
        try:
            with urllib.request.urlopen(
                    QRCODE_BASE + "/status", timeout=1) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.25)
    return False


def _qrcode_proxy(method, path, body=None):
    """把扫码接口转发给 qrcode 守护进程；返回 (payload, http_status, raw_bytes)。"""
    if not _ensure_qrcode_service():
        return {"success": False, "error": "扫码服务未就绪（缺少 qrcode_login.py 或启动失败）"}, 503, None
    url = QRCODE_BASE + path
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()
            ctype = resp.headers.get("Content-Type", "")
            if "image/" in ctype:
                return None, resp.status, raw
            try:
                return json.loads(raw.decode("utf-8")), resp.status, raw
            except ValueError:
                return {"success": False, "error": raw.decode("utf-8", "replace")[:500]}, resp.status, raw
    except urllib.error.HTTPError as exc:
        try:
            return json.loads(exc.read().decode("utf-8")), exc.code, None
        except Exception:
            return {"success": False, "error": "扫码服务返回 HTTP %d" % exc.code}, exc.code, None
    except Exception as exc:
        return {"success": False, "error": "扫码服务请求失败: %s" % exc}, 502, None

STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
}


def run_pipeline():
    """调用 pan-sync 流水线并返回结构化结果。"""
    start = time.time()

    def elapsed():
        return round(time.time() - start, 2)

    if not os.path.isfile(RUNNER):
        return {
            "success": False,
            "message": "找不到流水线脚本: %s" % RUNNER,
            "resource_count": 0, "scraped_ok": 0, "scraped_total": 0,
            "fetched": 0, "elapsed": elapsed(),
        }
    if not os.path.isfile(CONFIG_PATH):
        return {
            "success": False,
            "message": "找不到配置文件: %s" % CONFIG_PATH,
            "resource_count": 0, "scraped_ok": 0, "scraped_total": 0,
            "fetched": 0, "elapsed": elapsed(),
        }

    try:
        proc = subprocess.run(
            [sys.executable, RUNNER, "--config", CONFIG_PATH],
            cwd=SYNC_DIR,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=PIPELINE_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "message": "流水线执行超时（> %ds）" % PIPELINE_TIMEOUT,
            "resource_count": 0, "scraped_ok": 0, "scraped_total": 0,
            "fetched": 0, "elapsed": elapsed(),
        }
    except Exception as exc:  # 防御：捕获一切子进程启动异常
        return {
            "success": False,
            "message": "启动流水线失败: %s" % exc,
            "resource_count": 0, "scraped_ok": 0, "scraped_total": 0,
            "fetched": 0, "elapsed": elapsed(),
        }

    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    detail = combined.strip()

    # 解析流水线统计
    m_res = re.search(r"输出 resources\.json（共 (\d+) 条资源）", combined)
    m_scrape = re.search(r"刮削成功 (\d+) / (\d+)", combined)
    m_fetch = re.search(r"共获取 (\d+) 个资源文件夹", combined)

    resource_count = int(m_res.group(1)) if m_res else 0
    scraped_ok = int(m_scrape.group(1)) if m_scrape else 0
    scraped_total = int(m_scrape.group(2)) if m_scrape else 0
    fetched = int(m_fetch.group(1)) if m_fetch else 0

    if proc.returncode == 0:
        return {
            "success": True,
            "message": "刷新完成",
            "resource_count": resource_count,
            "scraped_ok": scraped_ok,
            "scraped_total": scraped_total,
            "fetched": fetched,
            "elapsed": elapsed(),
            "detail": detail,
        }

    return {
        "success": False,
        "message": "流水线执行失败（exit=%d）" % proc.returncode,
        "resource_count": resource_count,
        "scraped_ok": scraped_ok,
        "scraped_total": scraped_total,
        "fetched": fetched,
        "elapsed": elapsed(),
        "error": detail[-4000:] if detail else "无输出",
    }


def match_search(title, year=None):
    """调用 pan-sync/tmdb_search.py 搜索 TMDB 候选（movie+tv 合并）。"""
    if not os.path.isfile(TMDB_SEARCHER):
        return {"success": False, "error": "找不到 tmdb_search.py: %s" % TMDB_SEARCHER}
    cmd = [sys.executable, TMDB_SEARCHER, "--title", title]
    if year:
        cmd += ["--year", str(year)]
    try:
        proc = subprocess.run(
            cmd, cwd=SYNC_DIR, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=MATCH_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "TMDB 搜索超时（> %ds）" % MATCH_TIMEOUT}
    except Exception as exc:
        return {"success": False, "error": "启动 TMDB 搜索失败: %s" % exc}
    if proc.returncode != 0:
        return {"success": False, "error": (proc.stderr or proc.stdout or "").strip()[-1000:]}
    try:
        data = json.loads(proc.stdout)
    except ValueError:
        return {"success": False, "error": "tmdb_search 输出不是合法 JSON"}
    return {
        "success": True,
        "query": data.get("query", title),
        "year": data.get("year"),
        "results": data.get("results", []),
    }


def _read_resources():
    """读取 data/resources.json，返回 (data, path)；文件缺失/非法时返回 (None, path)。"""
    if not os.path.isfile(RESOURCES_PATH):
        return None, RESOURCES_PATH
    try:
        with open(RESOURCES_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh), RESOURCES_PATH
    except (OSError, ValueError):
        return None, RESOURCES_PATH


def _read_config():
    """读取 pan-sync/config.json，返回 (data, path)；文件缺失/非法时返回 (None, path)。"""
    if not os.path.isfile(CONFIG_PATH):
        return None, CONFIG_PATH
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh), CONFIG_PATH
    except (OSError, ValueError):
        return None, CONFIG_PATH


def _write_config(data):
    """把配置写回 pan-sync/config.json；成功返回 None，失败返回错误描述。"""
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        return None
    except OSError as exc:
        return "写回 config.json 失败: %s" % exc


def normalize_config(data):
    """规范化前端提交的配置：保留未知字段，补齐多夸克账号结构。

    quark_accounts 为 [{name, cookie}]；无数组时兼容旧字段 quark_cookie。
    """
    if not isinstance(data, dict):
        data = {}
    accounts = data.get("quark_accounts")
    if accounts is not None:
        if not isinstance(accounts, list):
            accounts = []
        cleaned = []
        for acc in accounts:
            if not isinstance(acc, dict):
                continue
            item = {}
            item["name"] = str(acc.get("name") or "").strip()
            item["cookie"] = str(acc.get("cookie") or "").strip()
            if item["name"] or item["cookie"]:
                cleaned.append(item)
        data["quark_accounts"] = cleaned
    else:
        # 兼容旧结构：无 quark_accounts 时保留 quark_cookie
        data.setdefault("quark_cookie", "")
    data.setdefault("quark_dir", "/媒体")
    data.setdefault("tmdb_api_key", "")
    data.setdefault("quark_mode", "cookie")
    data.setdefault("quark_client_id", "")
    data.setdefault("quark_client_secret", "")
    data.setdefault("output_path", "../pan-site/data/resources.json")
    # 分享鉴权头：创建夸克分享时附加的额外 header（如 X-Uc-Context-Token / sign）
    headers = data.get("share_headers")
    if headers is None:
        data["share_headers"] = {}
    elif not isinstance(headers, dict):
        data["share_headers"] = {}
    return data


def apply_update(folder_path, fields, season=None):
    """按 folder_path（可附 season 精确定位）更新资源记录的可编辑字段并写回。

    支持字段：title / category / poster / year / rating / description /
    cast / tags / links / matched。返回 (record, error)。
    """
    data, path = _read_resources()
    if data is None:
        return None, "读取 resources.json 失败: %s" % path
    resources = data.get("resources") or []
    found = None
    for res in resources:
        if res.get("folder_path") == folder_path:
            if season is not None:
                if res.get("season") != season:
                    continue
            found = res
            break
    if found is None:
        return None, "未找到 folder_path 对应的资源记录: %s" % folder_path

    if "title" in fields and fields["title"] is not None:
        found["title"] = str(fields["title"]).strip() or found.get("title", "")
    if "category" in fields and fields["category"] is not None:
        found["category"] = str(fields["category"]).strip() or found.get("category", "")
    if "poster" in fields and fields["poster"] is not None:
        val = str(fields["poster"]).strip()
        found["poster"] = val or None
    if "year" in fields:
        try:
            found["year"] = int(fields["year"]) if fields["year"] not in ("", None) else None
        except (TypeError, ValueError):
            found["year"] = None
    if "rating" in fields:
        try:
            found["rating"] = round(float(fields["rating"]), 1) if fields["rating"] not in ("", None) else None
        except (TypeError, ValueError):
            found["rating"] = None
    if "description" in fields and fields["description"] is not None:
        found["description"] = str(fields["description"]).strip()
    if "cast" in fields and isinstance(fields["cast"], list):
        found["cast"] = [str(c).strip() for c in fields["cast"] if str(c).strip()]
    if "tags" in fields and isinstance(fields["tags"], list):
        found["tags"] = [str(t).strip() for t in fields["tags"] if str(t).strip()]
    if "links" in fields and isinstance(fields["links"], list):
        cleaned_links = []
        for link in fields["links"]:
            if not isinstance(link, dict):
                continue
            url = str(link.get("url") or "").strip()
            name = str(link.get("name") or "夸克网盘").strip() or "夸克网盘"
            if url:
                cleaned_links.append({"name": name, "url": url})
        found["links"] = cleaned_links
    if "matched" in fields:
        found["matched"] = bool(fields["matched"])

    try:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
    except OSError as exc:
        return None, "写回 resources.json 失败: %s" % exc
    return found, None


def apply_match(folder_path, fields):
    """按 folder_path 定位资源记录，写入手动匹配的 TMDB 信息并写回文件。

    返回 (record, error)：成功时 record 为更新后的记录、error 为 None；
    失败时 record 为 None、error 为错误描述。
    """
    data, path = _read_resources()
    if data is None:
        return None, "读取 resources.json 失败: %s" % path
    resources = data.get("resources") or []
    found = None
    for res in resources:
        if res.get("folder_path") == folder_path:
            found = res
            break
    if found is None:
        return None, "未找到 folder_path 对应的资源记录: %s" % folder_path

    found["matched"] = True
    if fields.get("title"):
        found["title"] = fields["title"]
    if fields.get("year"):
        try:
            found["year"] = int(fields["year"])
        except (TypeError, ValueError):
            found["year"] = fields["year"]
    media_type = fields.get("media_type")
    if media_type in ("movie", "tv"):
        if media_type == "movie":
            found["category"] = "电影"
        else:
            found["category"] = "剧集"
        tag = "电影" if media_type == "movie" else "剧集"
        tags = list(found.get("tags") or [])
        if tag not in tags:
            tags.append(tag)
        found["tags"] = tags
    if fields.get("poster"):
        found["poster"] = fields["poster"]
    if fields.get("rating") is not None:
        try:
            found["rating"] = round(float(fields["rating"]), 1)
        except (TypeError, ValueError):
            found["rating"] = None
    if fields.get("overview"):
        found["description"] = fields["overview"]
    elif fields.get("overview") is not None:
        found["description"] = fields["overview"]

    try:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
    except OSError as exc:
        return None, "写回 resources.json 失败: %s" % exc
    return found, None


def add_resource(fields):
    """手动添加一条资源记录并写回 data/resources.json。

    - 自动分配新 id（现有最大 id + 1）
    - matched 固定为 True
    - folder_path 使用 manual:// 前缀标记手动添加（无则留空）
    返回 (record, error)：成功时 record 为新记录、error 为 None。
    """
    data, path = _read_resources()
    if data is None:
        return None, "读取 resources.json 失败: %s" % path
    resources = data.get("resources") or []
    if not isinstance(resources, list):
        resources = []
        data["resources"] = resources

    # 自动分配 id：取现有最大数值 id + 1
    max_id = 0
    for res in resources:
        if not isinstance(res, dict):
            continue
        try:
            rid = int(res.get("id"))
        except (TypeError, ValueError):
            continue
        if rid > max_id:
            max_id = rid
    new_id = max_id + 1

    def _clean_text(v):
        return str(v or "").strip()

    def _clean_list(v):
        if not isinstance(v, list):
            return []
        return [str(x).strip() for x in v if str(x).strip()]

    def _clean_links(v):
        if not isinstance(v, list):
            return []
        out = []
        for link in v:
            if not isinstance(link, dict):
                continue
            url = str(link.get("url") or "").strip()
            name = str(link.get("name") or "夸克网盘").strip() or "夸克网盘"
            if url:
                out.append({"name": name, "url": url})
        return out

    year = None
    if fields.get("year") not in ("", None):
        try:
            year = int(fields["year"])
        except (TypeError, ValueError):
            year = None
    rating = None
    if fields.get("rating") not in ("", None):
        try:
            rating = round(float(fields["rating"]), 1)
        except (TypeError, ValueError):
            rating = None

    record = {
        "id": new_id,
        "title": _clean_text(fields.get("title")),
        "category": _clean_text(fields.get("category")),
        "tags": _clean_list(fields.get("tags")),
        "status": _clean_text(fields.get("status")) or "已添加",
        "description": _clean_text(fields.get("description")),
        "updated_at": time.strftime("%Y-%m-%d"),
        "links": _clean_links(fields.get("links")),
        "matched": True,
        "folder_path": _clean_text(fields.get("folder_path")) or "manual://%d" % new_id,
        "file_count": None,
        "poster": _clean_text(fields.get("poster")) or None,
        "year": year,
        "rating": rating,
        "cast": _clean_list(fields.get("cast")),
        "parent": None,
        "season": None,
    }
    resources.append(record)

    try:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
    except OSError as exc:
        return None, "写回 resources.json 失败: %s" % exc
    return record, None


# ---------------------------------------------------------------- 自动推送
GIT_TIMEOUT = 60            # 秒；git commit/push 超时
REPO_DIR = BASE_DIR         # 仓库根目录即 pan-site 目录（.git 指向 Guabis/pan-site）


def _git_run(args, cwd=None):
    """运行 git 命令，返回 (returncode, stdout, stderr)。"""
    try:
        proc = subprocess.run(
            ["git", "-C", cwd or REPO_DIR] + args,
            capture_output=True, text=True, timeout=GIT_TIMEOUT,
        )
        return proc.returncode, (proc.stdout or "").strip(), (proc.stderr or "").strip()
    except FileNotFoundError:
        return -1, "", "git 未安装（PATH 中找不到 git 命令）"
    except subprocess.TimeoutExpired:
        return -1, "", "git 命令执行超时（%d 秒）" % GIT_TIMEOUT
    except Exception as exc:  # noqa: BLE001
        return -1, "", str(exc)


def git_commit_push(commit_msg):
    """保存 resources.json 后自动 commit + push 到 GitHub 仓库（Guabis/pan-site）。

    返回 {"pushed": bool, "message": str}：
    - 本地仓库尚无任何提交时先整体提交一次（静态站所有文件）；
    - 已有提交后仅提交 data/resources.json（避免把 server.py 等改动卷入）；
    - push 到 origin 的 main 分支（GitHub Pages 部署分支）。
    网络不可达 / 未配置 remote / 认证失败均不影响本地保存成功，
    此时 pushed=False 并返回原因，用户可稍后手动推送。
    """
    result = {"pushed": False, "message": ""}

    # 0) 未配置远程仓库时直接跳过
    rc, out, err = _git_run(["remote", "-v"])
    if rc != 0 or "origin" not in out:
        result["message"] = "未配置 git remote（origin），跳过自动推送"
        return result

    # 1) 是否已有首次提交
    rc, _out, _err = _git_run(["rev-parse", "--verify", "HEAD"])
    has_head = rc == 0

    if not has_head:
        # 首次提交：整个静态站纳入版本管理（.gitignore 负责排除敏感文件）
        rc, _out, err = _git_run(["add", "-A"])
        if rc != 0:
            result["message"] = "git add 失败: %s" % (err or _out)
            return result
        rc, _out, err = _git_run(["commit", "-m", "init pan-site static site"])
        if rc != 0:
            result["message"] = "git commit 失败: %s" % (err or _out)
            return result
    else:
        # 已有提交：只提交数据文件
        rc, _out, err = _git_run(["add", "--", "data/resources.json"])
        if rc != 0:
            result["message"] = "git add 失败: %s" % (err or _out)
            return result
        rc, _out, err = _git_run(["diff", "--cached", "--quiet"])
        if rc == 0:
            # 无任何改动（diff --cached --quiet 返回 0 表示暂存区与 HEAD 一致）
            result["pushed"] = True
            result["message"] = "resources.json 无改动，无需推送"
            return result
        rc, _out, err = _git_run(["commit", "-m", commit_msg, "--", "data/resources.json"])
        if rc != 0:
            result["message"] = "git commit 失败: %s" % (err or _out)
            return result

    # 2) 推送到 origin main
    rc, _out, err = _git_run(["push", "origin", "HEAD:refs/heads/main"])
    if rc != 0:
        result["message"] = "git push 失败（网络/认证问题）: %s" % (err or _out)
        return result
    result["pushed"] = True
    result["message"] = "已推送至 GitHub，Pages 将自动更新（约 1 分钟）"
    return result


class Handler(BaseHTTPRequestHandler):
    """静态文件 + POST /api/refresh + GET/POST /api/match/* 处理器。"""

    server_version = "PanSiteLocal/1.0"

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_body_json(self):
        """读取请求体并解析 JSON；失败返回 (None, 错误描述)。"""
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None, "Content-Length 非法"
        if length <= 0 or length > 1024 * 1024:
            return None, "请求体为空或过大"
        try:
            raw = self.rfile.read(length)
            return json.loads(raw.decode("utf-8")), None
        except (OSError, UnicodeDecodeError, ValueError) as exc:
            return None, "请求体不是合法 JSON: %s" % exc

    def _send_static(self, file_path):
        ext = os.path.splitext(file_path)[1].lower()
        ctype = STATIC_TYPES.get(ext, "application/octet-stream")
        try:
            with open(file_path, "rb") as f:
                body = f.read()
        except OSError:
            self.send_error(404, "File Not Found")
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        if path in ("", "/"):
            path = "/index.html"

        if path == "/api/health":
            # 本地管理页存活探测：前端据此区分「完整模式（本地后端）」与「静态模式（Pages）」
            self._send_json({"success": True, "mode": "full", "name": "pan-site-local"})
            return

        # GET /api/config —— 读取 pan-sync/config.json（含多夸克账号）
        if path == "/api/config":
            cfg, _ = _read_config()
            if cfg is None:
                self._send_json({"success": False, "error": "读取 config.json 失败"}, status=500)
                return
            self._send_json({"success": True, "config": cfg})
            return

        # GET /api/qrcode/status —— 扫码会话状态轮询（转发 qrcode 守护服务）
        if path == "/api/qrcode/status":
            payload, status, _ = _qrcode_proxy("GET", "/status")
            if payload is not None:
                self._send_json(payload, status=status)
            else:
                self._send_json({"success": False, "error": "扫码服务无响应"}, status=status)
            return

        # GET /api/qrcode/image —— 返回二维码 PNG（转发 qrcode 守护服务）
        if path == "/api/qrcode/image":
            payload, status, raw = _qrcode_proxy("GET", "/qrcode")
            if raw:
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(raw)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(raw)
                return
            if payload is not None:
                self._send_json(payload, status=status)
                return
            self._send_json({"success": False, "error": "二维码不可用"}, status=502)
            return

        # GET /api/match/search?title=xxx&year=yyyy —— TMDB 手动匹配候选搜索
        if path == "/api/match/search":
            qs = urllib.parse.parse_qs(parsed.query)
            title = (qs.get("title") or [""])[0].strip()
            if not title:
                self._send_json({"success": False, "error": "缺少 title 参数"}, status=400)
                return
            year_raw = (qs.get("year") or [""])[0].strip()
            year = None
            if year_raw:
                try:
                    year = int(year_raw)
                except ValueError:
                    self._send_json({"success": False, "error": "year 参数不是整数"}, status=400)
                    return
            result = match_search(title, year)
            self._send_json(result, status=200 if result.get("success") else 500)
            return

        # 防目录穿越：规范化后必须仍在 BASE_DIR 内
        rel = os.path.normpath(path.lstrip("/"))
        file_path = os.path.join(BASE_DIR, rel)
        if not os.path.abspath(file_path).startswith(os.path.abspath(BASE_DIR)) or not os.path.isfile(file_path):
            self.send_error(404, "Not Found")
            return

        self._send_static(file_path)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/refresh":
            # 触发流水线（同步 + 刮削），完成后返回结果
            result = run_pipeline()
            self._send_json(result)
            return
        if path == "/api/qrcode/start":
            # 启动扫码登录会话（转发 qrcode 守护服务）
            payload, status, _ = _qrcode_proxy("POST", "/start", body={})
            self._send_json(payload, status=status)
            return
        if path == "/api/qrcode/capture":
            # 进入/重置鉴权头捕获阶段（转发 qrcode 守护服务）
            payload, status, _ = _qrcode_proxy("POST", "/capture", body={})
            self._send_json(payload, status=status)
            return
        if path == "/api/qrcode/cancel":
            # 取消扫码会话并关闭浏览器（转发 qrcode 守护服务）
            payload, status, _ = _qrcode_proxy("POST", "/cancel", body={})
            self._send_json(payload, status=status)
            return
        if path == "/api/config":
            # 保存配置：TMDB Key / 多夸克账号列表等，写回 config.json
            body, err = self._read_body_json()
            if err:
                self._send_json({"success": False, "error": err}, status=400)
                return
            cfg = normalize_config(body)
            werr = _write_config(cfg)
            if werr:
                self._send_json({"success": False, "error": werr}, status=500)
                return
            self._send_json({"success": True, "config": cfg})
            return
        if path == "/api/update":
            # 编辑资源记录：按 folder_path（+可选 season）定位并写回可编辑字段
            body, err = self._read_body_json()
            if err:
                self._send_json({"success": False, "error": err}, status=400)
                return
            folder_path = (body.get("folder_path") or "").strip()
            if not folder_path:
                self._send_json({"success": False, "error": "缺少 folder_path 字段"}, status=400)
                return
            season = body.get("season")
            fields = dict(body)
            record, uerr = apply_update(folder_path, fields, season)
            if record is None:
                self._send_json({"success": False, "error": uerr},
                                status=404 if "未找到" in (uerr or "") else 500)
                return
            self._send_json({"success": True, "record": record,
                             "git": git_commit_push("update: %s" % (record.get("title") or "resource"))})
            return
        if path == "/api/add":
            # 手动添加资源记录：POST /api/add
            body, err = self._read_body_json()
            if err:
                self._send_json({"success": False, "error": err}, status=400)
                return
            title = (body.get("title") or "").strip()
            if not title:
                self._send_json({"success": False, "error": "缺少 title 字段"}, status=400)
                return
            record, aerr = add_resource(body)
            if record is None:
                self._send_json({"success": False, "error": aerr}, status=500)
                return
            self._send_json({"success": True, "record": record,
                             "git": git_commit_push("add: %s" % (record.get("title") or "resource"))})
            return
        if path == "/api/match/apply":
            # 手动匹配：按 folder_path 定位记录，写入 TMDB 信息并写回
            body, err = self._read_body_json()
            if err:
                self._send_json({"success": False, "error": err}, status=400)
                return
            folder_path = (body.get("folder_path") or "").strip()
            if not folder_path:
                self._send_json({"success": False, "error": "缺少 folder_path 字段"}, status=400)
                return
            record, err = apply_match(folder_path, body)
            if record is None:
                self._send_json({"success": False, "error": err}, status=404 if "未找到" in (err or "") else 500)
                return
            self._send_json({"success": True, "record": record,
                             "git": git_commit_push("match: %s" % (record.get("title") or "resource"))})
            return
        self.send_error(404, "Not Found")

    def log_message(self, fmt, *args):
        # 精简控制台输出：仅打印 POST 刷新请求
        if "/api/refresh" in (fmt % args):
            print("[server] %s" % (fmt % args))


def _stop_qrcode_service():
    """退出时回收扫码守护子进程。"""
    global QRCODE_PROC
    if QRCODE_PROC is not None and QRCODE_PROC.poll() is None:
        try:
            QRCODE_PROC.terminate()
        except Exception:
            pass


def main():
    port = DEFAULT_PORT
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    host = "127.0.0.1"
    atexit.register(_stop_qrcode_service)
    if not _ensure_qrcode_service():
        print("[server] 警告：扫码守护服务未就绪，/api/qrcode/* 接口将不可用")
    server = ThreadingHTTPServer((host, port), Handler)
    print("pan-site 服务已启动: http://%s:%d  (刷新 POST /api/refresh, 匹配 GET/POST /api/match/*, 配置 GET/POST /api/config, 编辑 POST /api/update, 扫码 /api/qrcode/*)" % (host, port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        _stop_qrcode_service()
        print("pan-site 服务已停止")


if __name__ == "__main__":
    main()
