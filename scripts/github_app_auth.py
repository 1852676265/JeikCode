import sys
import time
import json
import jwt
import urllib.request
import urllib.error

def get_installation_token(app_id: int, private_key_path: str, repo_owner_or_full: str = "jeikl/JeikCode"):
    with open(private_key_path, "r", encoding="utf-8") as f:
        private_key = f.read()

    now = int(time.time())
    payload = {
        "iat": now - 60,
        "exp": now + (9 * 60),
        "iss": str(app_id),
    }

    encoded_jwt = jwt.encode(payload, private_key, algorithm="RS256")

    # 1. 查询该 App 的全部安装 (Installations)
    req = urllib.request.Request(
        "https://api.github.com/app/installations",
        headers={
            "Authorization": f"Bearer {encoded_jwt}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "JeikCode-Bot-Helper",
        }
    )

    try:
        with urllib.request.urlopen(req) as resp:
            installations = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"Error fetching installations: {e.code} {e.read().decode()}")
        return None

    if not installations:
        print("Error: No installations found. Please make sure you clicked 'Install App' in the left menu of the GitHub App settings!")
        return None

    # 找到目标仓库或账号所属的安装 ID
    target_inst = installations[0]
    for inst in installations:
        account_login = inst.get("account", {}).get("login", "")
        if account_login.lower() in repo_owner_or_full.lower():
            target_inst = inst
            break

    inst_id = target_inst["id"]
    print(f"Found Installation ID: {inst_id} (Account: {target_inst.get('account', {}).get('login')})")

    # 2. 为该安装生成真实的官方 Installation Access Token
    token_req = urllib.request.Request(
        f"https://api.github.com/app/installations/{inst_id}/access_tokens",
        data=b"{}",
        headers={
            "Authorization": f"Bearer {encoded_jwt}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "JeikCode-Bot-Helper",
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(token_req) as resp:
            data = json.loads(resp.read().decode())
            token = data["token"]
            expires_at = data.get("expires_at")
            print(f"Successfully generated GitHub App Token! (Expires: {expires_at})")
            return token
    except urllib.error.HTTPError as e:
        print(f"Error creating access token: {e.code} {e.read().decode()}")
        return None

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python github_app_auth.py <app_id> <private_key_path> [repo]")
        sys.exit(1)
    app_id = int(sys.argv[1])
    key_path = sys.argv[2]
    repo = sys.argv[3] if len(sys.argv) > 3 else "jeikl/JeikCode"
    token = get_installation_token(app_id, key_path, repo)
    if token:
        print(f"TOKEN={token}")
