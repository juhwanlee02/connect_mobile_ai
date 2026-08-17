import { randomLicenseKey } from "../src/license.js";

// 판매자가 고객에게 줄 라이선스 키를 1개(또는 N개) 발급한다.
const n = Number(process.argv[2] ?? 1);
for (let i = 0; i < n; i++) console.log(randomLicenseKey());
