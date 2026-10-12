import {defineConfig} from '@playwright/test';
process.env.MAIL_TEST_WORKSPACE='begum';
export default defineConfig({
 testDir:'./tests/begum-mail',timeout:30000,workers:1,
 use:{baseURL:'http://127.0.0.1:8767',headless:true,serviceWorkers:'block'},
 webServer:{command:'python3 -m http.server 8767 --bind 127.0.0.1 --directory sites/begum',url:'http://127.0.0.1:8767/',reuseExistingServer:!process.env.CI},
 projects:[{name:'desktop',use:{viewport:{width:1440,height:900}}},{name:'iphone',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1}}]
});