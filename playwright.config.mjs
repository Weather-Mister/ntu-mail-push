import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./tests/browser',timeout:25000,workers:1,
 use:{baseURL:'http://127.0.0.1:8765',headless:true,serviceWorkers:'block',launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--disable-gpu']}:{}},
 webServer:{command:'python3 -m http.server 8765 --directory sites/eren',url:'http://127.0.0.1:8765',reuseExistingServer:!process.env.CI},
 projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'iphone',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1}}]
});
