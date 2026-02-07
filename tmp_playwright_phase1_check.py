from __future__ import annotations

from pathlib import Path
import time

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


def main() -> None:
    output_dir = Path("tmp/playwright-phase1")
    output_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.firefox.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})

        target_urls = [
            "http://localhost:5173/listing/15b6cf75-6c89-4a87-98bd-a7608857bed7",
            "http://127.0.0.1:5173/listing/15b6cf75-6c89-4a87-98bd-a7608857bed7",
        ]
        last_error: Exception | None = None
        for _ in range(8):
            for url in target_urls:
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=15000)
                    last_error = None
                    break
                except Exception as err:
                    last_error = err
            if last_error is None:
                break
            time.sleep(1)

        if last_error is not None:
            raise last_error

        page.wait_for_load_state("networkidle", timeout=60000)
        page.screenshot(path=str(output_dir / "01-home.png"), full_page=True)

        # Try to open the evaluation overlay from likely entry points.
        candidate_buttons = [
            'button:has-text("AI Evaluation")',
            'button:has-text("Evaluate")',
            'button:has-text("Run Evaluation")',
            '[role="button"]:has-text("AI Evaluation")',
            '[role="button"]:has-text("Evaluate")',
        ]

        opened = False
        for selector in candidate_buttons:
            locator = page.locator(selector).first
            if locator.count() == 0:
                continue
            locator.click(timeout=5000)
            page.wait_for_timeout(800)
            if page.locator("text=AI Evaluation").count() > 0:
                opened = True
                break

        if not opened:
            page.screenshot(
                path=str(output_dir / "02-overlay-not-found.png"), full_page=True
            )
            print("RESULT: overlay_not_found")
            browser.close()
            return

        page.wait_for_load_state("networkidle", timeout=60000)
        page.screenshot(path=str(output_dir / "03-overlay-open.png"), full_page=True)

        # Go to Transcription tab (Step 2)
        if page.locator('button:has-text("Transcription")').count() > 0:
            page.locator('button:has-text("Transcription")').first.click()
            page.wait_for_timeout(400)

        # Click derive action if enabled
        derive_btn = page.locator(
            'button:has-text("Derive from Structured Output")'
        ).first
        if derive_btn.count() > 0:
            try:
                derive_btn.click(timeout=3000)
                page.wait_for_timeout(700)
            except PlaywrightTimeoutError:
                pass

        page.screenshot(
            path=str(output_dir / "04-after-derive-step2.png"), full_page=True
        )

        # Go to Evaluation tab (Step 3)
        if page.locator('button:has-text("Evaluation")').count() > 0:
            page.locator('button:has-text("Evaluation")').first.click()
            page.wait_for_timeout(400)

        derive_btn_step3 = page.locator(
            'button:has-text("Derive from Structured Output")'
        ).first
        if derive_btn_step3.count() > 0:
            try:
                derive_btn_step3.click(timeout=3000)
                page.wait_for_timeout(700)
            except PlaywrightTimeoutError:
                pass

        page.screenshot(
            path=str(output_dir / "05-after-derive-step3.png"), full_page=True
        )

        # Capture page text markers for save behavior visibility
        transient_markers = page.locator(
            "text=Using transient schema for this run"
        ).count()
        save_ctas = page.locator('button:has-text("Save to Library")').count()
        print(f"RESULT: transient_markers={transient_markers}, save_ctas={save_ctas}")

        browser.close()


if __name__ == "__main__":
    main()
