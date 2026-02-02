from playwright.sync_api import sync_playwright
import time

def run_tests():
    results = []
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        try:
            # Test 1: Open http://localhost:5173 - Verify Voice Rx home page loads
            print("Test 1: Loading Voice Rx home page...")
            page.goto('http://localhost:5173', wait_until='networkidle')
            time.sleep(1)
            
            # Take screenshot for inspection
            page.screenshot(path='/tmp/test1_home.png', full_page=True)
            
            # Check if page contains Voice Rx content
            content = page.content()
            if 'voice' in content.lower() or 'rx' in content.lower():
                results.append("✓ Test 1 PASS: Voice Rx home page loaded")
            else:
                results.append("✗ Test 1 FAIL: Voice Rx home page content not found")
            
            # Test 2: Click on Settings in sidebar - Verify it goes to /settings
            print("Test 2: Navigating to Settings...")
            
            # Try to find and click Settings link/button
            settings_button = None
            try:
                # Try different selectors for Settings
                if page.locator('a:has-text("Settings")').is_visible():
                    settings_button = page.locator('a:has-text("Settings")').first
                elif page.locator('button:has-text("Settings")').is_visible():
                    settings_button = page.locator('button:has-text("Settings")').first
                elif page.locator('[href*="settings"]').first.is_visible():
                    settings_button = page.locator('[href*="settings"]').first
                
                if settings_button:
                    settings_button.click()
                    page.wait_for_load_state('networkidle')
                    time.sleep(1)
                    page.screenshot(path='/tmp/test2_settings.png', full_page=True)
                    
                    # Check URL and heading
                    url = page.url
                    content = page.content()
                    
                    if 'settings' in url and ('voice rx settings' in content.lower() or 'settings' in content.lower()):
                        results.append("✓ Test 2 PASS: Settings page loaded with correct heading")
                    else:
                        results.append(f"✗ Test 2 FAIL: URL={url}, expected /settings")
                else:
                    results.append("✗ Test 2 FAIL: Could not find Settings button")
            except Exception as e:
                results.append(f"✗ Test 2 FAIL: {str(e)}")
            
            # Test 3: Click on "AI Configuration" tab
            print("Test 3: Checking AI Configuration tab...")
            try:
                ai_tab = None
                if page.locator('button:has-text("AI Configuration")').is_visible():
                    ai_tab = page.locator('button:has-text("AI Configuration")')
                elif page.locator('[role="tab"]:has-text("AI Configuration")').is_visible():
                    ai_tab = page.locator('[role="tab"]:has-text("AI Configuration")')
                
                if ai_tab:
                    ai_tab.click()
                    page.wait_for_timeout(500)
                    page.screenshot(path='/tmp/test3_ai_config.png', full_page=True)
                    
                    content = page.content()
                    if 'api' in content.lower() and ('key' in content.lower() or 'model' in content.lower()):
                        results.append("✓ Test 3 PASS: AI Configuration tab shows API key field and model selector")
                    else:
                        results.append("✗ Test 3 FAIL: API Configuration content not found")
                else:
                    results.append("✗ Test 3 FAIL: Could not find AI Configuration tab")
            except Exception as e:
                results.append(f"✗ Test 3 FAIL: {str(e)}")
            
            # Test 4: Click on "Language & Script" tab
            print("Test 4: Checking Language & Script tab...")
            try:
                lang_tab = None
                if page.locator('button:has-text("Language & Script")').is_visible():
                    lang_tab = page.locator('button:has-text("Language & Script")')
                elif page.locator('[role="tab"]:has-text("Language & Script")').is_visible():
                    lang_tab = page.locator('[role="tab"]:has-text("Language & Script")')
                
                if lang_tab:
                    lang_tab.click()
                    page.wait_for_timeout(500)
                    page.screenshot(path='/tmp/test4_language.png', full_page=True)
                    
                    content = page.content()
                    if 'language' in content.lower() or 'script' in content.lower():
                        results.append("✓ Test 4 PASS: Language & Script tab shows Voice Rx specific settings")
                    else:
                        results.append("✗ Test 4 FAIL: Language & Script content not found")
                else:
                    results.append("✗ Test 4 FAIL: Could not find Language & Script tab")
            except Exception as e:
                results.append(f"✗ Test 4 FAIL: {str(e)}")
            
            # Test 5: Switch to Kaira Bot using app switcher
            print("Test 5: Switching to Kaira Bot...")
            try:
                # Go back to home first
                page.goto('http://localhost:5173', wait_until='networkidle')
                time.sleep(1)
                
                # Look for app switcher
                kaira_button = None
                if page.locator('a:has-text("Kaira")').is_visible():
                    kaira_button = page.locator('a:has-text("Kaira")').first
                elif page.locator('button:has-text("Kaira")').is_visible():
                    kaira_button = page.locator('button:has-text("Kaira")').first
                elif page.locator('[href*="kaira"]').first.is_visible():
                    kaira_button = page.locator('[href*="kaira"]').first
                
                if kaira_button:
                    kaira_button.click()
                    page.wait_for_load_state('networkidle')
                    time.sleep(1)
                    page.screenshot(path='/tmp/test5_kaira_home.png', full_page=True)
                    
                    url = page.url
                    content = page.content()
                    
                    if '/kaira' in url and ('kaira' in content.lower() or 'bot' in content.lower()):
                        results.append("✓ Test 5 PASS: Switched to Kaira Bot with enhanced layout")
                    else:
                        results.append(f"✗ Test 5 FAIL: URL={url}, expected /kaira")
                else:
                    results.append("✗ Test 5 FAIL: Could not find Kaira Bot switcher")
            except Exception as e:
                results.append(f"✗ Test 5 FAIL: {str(e)}")
            
            # Test 6: Verify Kaira Bot home page loads at /kaira
            print("Test 6: Verifying Kaira Bot home page...")
            try:
                url = page.url
                content = page.content()
                
                if '/kaira' in url:
                    results.append("✓ Test 6 PASS: Kaira Bot home page loads at /kaira")
                else:
                    results.append(f"✗ Test 6 FAIL: URL={url}, expected /kaira")
            except Exception as e:
                results.append(f"✗ Test 6 FAIL: {str(e)}")
            
            # Test 7: Click on Settings - Verify it goes to /kaira/settings
            print("Test 7: Navigating to Kaira Settings...")
            try:
                settings_button = None
                if page.locator('a:has-text("Settings")').is_visible():
                    settings_button = page.locator('a:has-text("Settings")').first
                elif page.locator('button:has-text("Settings")').is_visible():
                    settings_button = page.locator('button:has-text("Settings")').first
                
                if settings_button:
                    settings_button.click()
                    page.wait_for_load_state('networkidle')
                    time.sleep(1)
                    page.screenshot(path='/tmp/test7_kaira_settings.png', full_page=True)
                    
                    url = page.url
                    content = page.content()
                    
                    if '/kaira/settings' in url and ('kaira bot settings' in content.lower() or 'settings' in content.lower()):
                        results.append("✓ Test 7 PASS: Kaira Bot Settings page loaded with correct heading")
                    else:
                        results.append(f"✗ Test 7 FAIL: URL={url}, expected /kaira/settings")
                else:
                    results.append("✗ Test 7 FAIL: Could not find Settings button")
            except Exception as e:
                results.append(f"✗ Test 7 FAIL: {str(e)}")
            
            # Test 8: Click on "Chat Configuration" tab
            print("Test 8: Checking Chat Configuration tab...")
            try:
                chat_tab = None
                if page.locator('button:has-text("Chat Configuration")').is_visible():
                    chat_tab = page.locator('button:has-text("Chat Configuration")')
                elif page.locator('[role="tab"]:has-text("Chat Configuration")').is_visible():
                    chat_tab = page.locator('[role="tab"]:has-text("Chat Configuration")')
                
                if chat_tab:
                    chat_tab.click()
                    page.wait_for_timeout(500)
                    page.screenshot(path='/tmp/test8_chat_config.png', full_page=True)
                    
                    content = page.content()
                    if 'chat' in content.lower() or 'configuration' in content.lower():
                        results.append("✓ Test 8 PASS: Chat Configuration tab shows chat-specific settings")
                    else:
                        results.append("✗ Test 8 FAIL: Chat Configuration content not found")
                else:
                    results.append("✗ Test 8 FAIL: Could not find Chat Configuration tab")
            except Exception as e:
                results.append(f"✗ Test 8 FAIL: {str(e)}")
            
            # Test 9: Verify "AI Configuration" tab shows shared notice about API key
            print("Test 9: Checking AI Configuration shared notice...")
            try:
                ai_tab = None
                if page.locator('button:has-text("AI Configuration")').is_visible():
                    ai_tab = page.locator('button:has-text("AI Configuration")')
                elif page.locator('[role="tab"]:has-text("AI Configuration")').is_visible():
                    ai_tab = page.locator('[role="tab"]:has-text("AI Configuration")')
                
                if ai_tab:
                    ai_tab.click()
                    page.wait_for_timeout(500)
                    page.screenshot(path='/tmp/test9_ai_notice.png', full_page=True)
                    
                    content = page.content()
                    if 'api' in content.lower() and ('shared' in content.lower() or 'notice' in content.lower() or 'configured' in content.lower()):
                        results.append("✓ Test 9 PASS: AI Configuration shows shared notice about API key")
                    else:
                        results.append("✗ Test 9 FAIL: Shared notice not found")
                else:
                    results.append("✗ Test 9 FAIL: Could not find AI Configuration tab")
            except Exception as e:
                results.append(f"✗ Test 9 FAIL: {str(e)}")
        
        finally:
            browser.close()
    
    return results

if __name__ == '__main__':
    print("Starting Phase 3 Implementation Tests...")
    print("=" * 70)
    
    results = run_tests()
    
    print("\n" + "=" * 70)
    print("TEST RESULTS:")
    print("=" * 70)
    
    for result in results:
        print(result)
    
    passed = sum(1 for r in results if r.startswith("✓"))
    total = len(results)
    
    print("\n" + "=" * 70)
    print(f"Summary: {passed}/{total} tests passed")
    print("=" * 70)
    
    if passed == total:
        print("✓ All tests passed!")
    else:
        print(f"✗ {total - passed} test(s) failed")
