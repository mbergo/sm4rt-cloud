#!/usr/bin/env python3
"""SM4RT-CLOUD Selenium E2E — create & delete real resources through the console UI.

Flow (all through the browser, like a human):
  1. Token login
  2. Create workspace (TTL 1h) and wait until ready
  3. Open console -> Servers: launch a VM, wait running
  4. Containers: deploy an image, wait running, verify public URL responds
  5. Delete container (two-click confirm)
  6. Terminate VM (two-click confirm)
  7. Back to dashboard -> delete workspace (two-click confirm), wait card gone

Env vars:
  E2E_BASE_URL   target console (default https://cloud.pajesystems.io)
  E2E_TOKEN      cloud token (required)
  E2E_WORKSPACE  workspace name (default seltest)
  E2E_HEADLESS   1 = headless (default 1)
  E2E_SHOTS      screenshot dir (default /tmp/selenium-e2e)

Requires: google-chrome + `pip install selenium` (>=4.6, Selenium Manager
downloads the matching chromedriver automatically).
"""

from __future__ import annotations

import os
import sys
import time
import urllib.error
import urllib.request

from selenium import webdriver
from selenium.common.exceptions import StaleElementReferenceException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait

BASE_URL = os.environ.get("E2E_BASE_URL", "https://cloud.pajesystems.io")
TOKEN = os.environ.get("E2E_TOKEN", "")
WS = os.environ.get("E2E_WORKSPACE", "seltest")
HEADLESS = os.environ.get("E2E_HEADLESS", "1") == "1"
SHOTS = os.environ.get("E2E_SHOTS", "/tmp/selenium-e2e")

VM_NAME = "sel-vm"
TASK_NAME = "selweb"
TASK_IMAGE = "nginxdemos/hello:plain-text"

_step = 0


def api_delete_workspace(name: str) -> bool:
    """Fallback cleanup via API (retries TLS resets). Not part of the UI test —
    used only so a leftover workspace can't wedge the run before step 2."""
    for attempt in range(5):
        try:
            req = urllib.request.Request(
                f"{BASE_URL}/api/instances/{name}",
                method="DELETE",
                headers={"Authorization": f"Bearer {TOKEN}"},
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status in (200, 202, 204)
        except urllib.error.HTTPError as e:
            return e.code == 404  # already gone
        except Exception as e:  # noqa: BLE001 - TLS reset during caddy reload
            log(f"   api delete retry {attempt + 1}/5: {e}")
            time.sleep(3)
    return False


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def shot(driver: webdriver.Chrome, name: str) -> None:
    global _step
    _step += 1
    path = os.path.join(SHOTS, f"{_step:02d}-{name}.png")
    driver.save_screenshot(path)
    log(f"  screenshot -> {path}")


def wait_for(driver, cond, timeout: int, desc: str):
    log(f"  wait: {desc} (<= {timeout}s)")
    return WebDriverWait(driver, timeout, poll_frequency=1.0).until(cond)


def find_button(driver, text: str):
    """Find a visible <button>: exact text match wins, else first containing `text`."""
    partial = None
    for el in driver.find_elements(By.TAG_NAME, "button"):
        try:
            if not el.is_displayed():
                continue
            t = el.text.strip()
            if t == text:
                return el
            if partial is None and text in t:
                partial = el
        except StaleElementReferenceException:
            continue
    return partial


def click_button(driver, text: str, timeout: int = 20):
    btn = wait_for(driver, lambda d: find_button(d, text), timeout, f"button '{text}'")
    # JS click: immune to overlay/toast interception and arm-state races
    driver.execute_script("arguments[0].click();", btn)
    return btn


def row_with_text(driver, text: str):
    for tr in driver.find_elements(By.CSS_SELECTOR, "tbody tr"):
        try:
            if text in tr.text:
                return tr
        except StaleElementReferenceException:
            continue
    return None


def row_state(driver, name: str) -> str | None:
    tr = row_with_text(driver, name)
    return tr.text if tr else None


def two_click_danger(driver, label: str, confirm_label: str, timeout: int = 20) -> None:
    """DangerButton arm pattern: first click arms (label changes), second executes."""
    click_button(driver, label, timeout)
    time.sleep(0.5)
    click_button(driver, confirm_label, 10)


def nav_section(driver, label: str) -> None:
    """Click a sidebar section in the console."""
    btn = wait_for(
        driver,
        lambda d: next(
            (
                b
                for b in d.find_elements(By.CSS_SELECTOR, "aside nav button")
                if b.text.strip() == label
            ),
            None,
        ),
        20,
        f"sidebar '{label}'",
    )
    btn.click()


def set_input_by_placeholder(driver, placeholder: str, value: str, timeout: int = 15):
    el = wait_for(
        driver,
        lambda d: next(
            (
                i
                for i in d.find_elements(By.CSS_SELECTOR, f'input[placeholder="{placeholder}"]')
                if i.is_displayed()
            ),
            None,
        ),
        timeout,
        f"input placeholder '{placeholder}'",
    )
    el.clear()
    el.send_keys(value)
    return el


def http_ok(url: str, timeout: int = 10) -> bool:
    try:
        req = urllib.request.Request(url, headers={"user-agent": "sm4rt-e2e"})
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return 200 <= res.status < 400
    except Exception:
        return False


def delete_workspace_card(driver, name: str, timeout: int = 30) -> bool:
    """Find the card containing `name` and run the 2-click delete. Returns True once
    the card visibly reacts (enters 'deleting' or disappears). Retries the 2-click
    up to 3 times — the confirm state auto-resets after 3s, so a slow poll cycle can
    swallow the second click."""

    def card_of(btn):
        node = btn
        for _ in range(8):
            node = node.find_element(By.XPATH, "..")
            if len(node.find_elements(By.CSS_SELECTOR, 'button[aria-label="Delete instance"]')) > 1:
                return None
            if name in node.text:
                return node
        return None

    def card_delete_btn(d):
        for btn in d.find_elements(By.CSS_SELECTOR, 'button[aria-label="Delete instance"]'):
            try:
                if card_of(btn) is not None:
                    return btn
            except (StaleElementReferenceException, Exception):
                continue
        return None

    def card_reacted(d) -> bool:
        """True when the card is gone or shows a deleting state."""
        try:
            btn = card_delete_btn(d)
            if btn is None:
                return True
            card = card_of(btn)
            return card is None or "deleting" in card.text.lower()
        except Exception:
            return True

    try:
        WebDriverWait(driver, timeout, poll_frequency=1.0).until(card_delete_btn)
    except Exception:
        return False

    for attempt in range(1, 4):
        btn = card_delete_btn(driver)
        if btn is None:
            return True  # card already gone
        driver.execute_script("arguments[0].click()", btn)
        try:
            confirm = wait_for(
                driver,
                lambda d: next(
                    (
                        b
                        for b in d.find_elements(By.CSS_SELECTOR, 'button[aria-label="Confirm delete"]')
                        if b.is_displayed()
                    ),
                    None,
                ),
                5,
                f"confirm delete (workspace, attempt {attempt})",
            )
        except Exception:
            continue
        driver.execute_script("arguments[0].click()", confirm)
        try:
            WebDriverWait(driver, 15, poll_frequency=1.0).until(card_reacted)
            return True
        except Exception:
            log(f"   delete click had no visible effect (attempt {attempt}) — retrying")
    return False


def main() -> int:
    if not TOKEN:
        print("E2E_TOKEN is required", file=sys.stderr)
        return 2

    os.makedirs(SHOTS, exist_ok=True)
    opts = Options()
    if HEADLESS:
        opts.add_argument("--headless=new")
    opts.add_argument("--window-size=1440,1000")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    driver = webdriver.Chrome(options=opts)
    driver.set_page_load_timeout(60)

    failures: list[str] = []
    try:
        # ————— 1. Login —————
        log(f"1) login at {BASE_URL}")
        driver.get(BASE_URL)
        token_input = wait_for(
            driver,
            lambda d: next(
                (i for i in d.find_elements(By.CSS_SELECTOR, 'input[type="password"]') if i.is_displayed()),
                None,
            ),
            30,
            "token input",
        )
        token_input.send_keys(TOKEN)
        click_button(driver, "Sign in")
        wait_for(driver, lambda d: find_button(d, "New instance"), 30, "dashboard (New instance)")
        shot(driver, "dashboard")
        log("   ok: logged in")

        # ————— cleanup: leftover workspace from a previous run —————
        time.sleep(2)
        if any(WS in c.text for c in driver.find_elements(By.CSS_SELECTOR, "main *") if c.text.strip() == WS):
            log(f"   leftover workspace '{WS}' found — deleting first")
            deleted_via_ui = delete_workspace_card(driver, WS)
            if not deleted_via_ui:
                log("   NOTE: UI delete of leftover failed — falling back to API cleanup (not counted as a UI test)")
                if not api_delete_workspace(WS):
                    raise RuntimeError(f"could not clean up leftover workspace '{WS}' via UI or API")
                driver.refresh()
            WebDriverWait(driver, 180, poll_frequency=3.0).until(
                lambda d: not any(
                    WS == el.text.strip() for el in d.find_elements(By.CSS_SELECTOR, "main *")
                )
            )
            log("   leftover deleted")

        # ————— 2. Create workspace —————
        log(f"2) create workspace '{WS}' (TTL 1h)")
        click_button(driver, "New instance")
        set_input_by_placeholder(driver, "e.g. swift-otter", WS)
        click_button(driver, "1h")
        shot(driver, "create-modal")
        click_button(driver, "Create instance")
        open_console = wait_for(driver, lambda d: find_button(d, "Open console"), 300, "workspace ready")
        shot(driver, "workspace-ready")
        log("   ok: workspace ready")
        open_console.click()

        # console loads
        wait_for(driver, lambda d: find_button(d, "All instances"), 30, "console")
        shot(driver, "console-overview")

        # ————— 3. Launch a VM —————
        log(f"3) launch server '{VM_NAME}' (Alpine, nano)")
        nav_section(driver, "Servers")
        click_button(driver, "Launch server")
        set_input_by_placeholder(driver, "web-1", VM_NAME)
        selects = [s for s in driver.find_elements(By.TAG_NAME, "select") if s.is_displayed()]
        Select(selects[-2]).select_by_visible_text("Alpine 3.20")
        Select(selects[-1]).select_by_visible_text("Nano — 0.5 vCPU · 512 MB")
        shot(driver, "vm-form")
        click_button(driver, "Launch")
        wait_for(driver, lambda d: row_with_text(d, VM_NAME), 60, "VM row")
        WebDriverWait(driver, 180, poll_frequency=3.0).until(
            lambda d: "running" in (row_state(d, VM_NAME) or "").lower()
        )
        shot(driver, "vm-running")
        log("   ok: VM running")

        # ————— 4. Deploy a container —————
        log(f"4) deploy container '{TASK_NAME}' ({TASK_IMAGE})")
        nav_section(driver, "Containers")
        click_button(driver, "Deploy container")
        set_input_by_placeholder(driver, "api", TASK_NAME)
        set_input_by_placeholder(driver, "nginx:alpine", TASK_IMAGE)
        set_input_by_placeholder(driver, "80", "80")
        shot(driver, "task-form")
        click_button(driver, "Deploy")
        wait_for(driver, lambda d: row_with_text(d, TASK_NAME), 60, "task row")
        WebDriverWait(driver, 180, poll_frequency=3.0).until(
            lambda d: "running" in (row_state(d, TASK_NAME) or "").lower()
        )
        shot(driver, "task-running")
        log("   ok: container running")

        # verify public URL actually serves
        tr = row_with_text(driver, TASK_NAME)
        links = tr.find_elements(By.TAG_NAME, "a")
        if links:
            url = links[0].get_attribute("href")
            log(f"   verifying public URL {url}")
            deadline = time.time() + 120
            ok = False
            while time.time() < deadline:
                if http_ok(url):
                    ok = True
                    break
                time.sleep(5)
            if ok:
                log("   ok: public URL responds")
            else:
                failures.append(f"public URL never responded: {url}")
        else:
            failures.append("task row has no public URL link")

        # ————— 5. Delete the container —————
        log(f"5) delete container '{TASK_NAME}'")
        if not find_button(driver, "Delete"):  # UI auto-selects after deploy; click only if panel closed
            row_with_text(driver, TASK_NAME).click()
        two_click_danger(driver, "Delete", "Confirm delete")
        WebDriverWait(driver, 120, poll_frequency=3.0).until(
            lambda d: row_with_text(d, TASK_NAME) is None
        )
        shot(driver, "task-deleted")
        log("   ok: container gone")

        # ————— 6. Terminate the VM —————
        log(f"6) terminate server '{VM_NAME}'")
        nav_section(driver, "Servers")
        wait_for(driver, lambda d: row_with_text(d, VM_NAME), 30, "VM row (for delete)")
        if not find_button(driver, "Terminate"):  # UI auto-selects after launch; click only if panel closed
            row_with_text(driver, VM_NAME).click()
        two_click_danger(driver, "Terminate", "Confirm terminate")
        WebDriverWait(driver, 120, poll_frequency=3.0).until(
            lambda d: row_with_text(d, VM_NAME) is None
        )
        shot(driver, "vm-terminated")
        log("   ok: VM gone")

        # ————— 7. Delete the workspace —————
        log(f"7) delete workspace '{WS}'")
        click_button(driver, "All instances")
        wait_for(driver, lambda d: find_button(d, "New instance"), 30, "dashboard")
        time.sleep(2)
        if not delete_workspace_card(driver, WS):
            failures.append(f"could not find delete button for workspace {WS}")
        else:
            WebDriverWait(driver, 240, poll_frequency=3.0).until(
                lambda d: not any(
                    WS == el.text.strip() for el in d.find_elements(By.CSS_SELECTOR, "main *")
                )
            )
            shot(driver, "workspace-deleted")
            log("   ok: workspace card gone")

    except Exception as exc:  # noqa: BLE001
        shot(driver, "FAILURE")
        failures.append(f"{type(exc).__name__}: {exc}")
    finally:
        driver.quit()

    if failures:
        log("E2E FAILED:")
        for f in failures:
            log(f"  - {f}")
        return 1
    log("E2E PASSED — created & deleted VM, container and workspace through the UI")
    return 0


if __name__ == "__main__":
    sys.exit(main())
