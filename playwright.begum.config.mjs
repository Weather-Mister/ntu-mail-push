import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/begum-browser',
  timeout: 30000,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:8766',
    headless: true,
    serviceWorkers: 'block'
  },
  webServer: {
    command: 'python3 -m http.server 8766 --bind 127.0.0.1 --directory sites/begum',
    url: 'http://127.0.0.1:8766/',
    reuseExistingServer: !process.env.CI
  },
  projects: [
    {name:'mac-1440',use:{viewport:{width:1440,height:900}}},
    {name:'mac-1000',use:{viewport:{width:1000,height:760}}},
    {name:'iphone-390',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1}}
  ]
});
