const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

const root = path.resolve(__dirname, '..', '..', '..');
const frontendDir = path.join(root, 'frontend');
const backendDist = path.join(__dirname, '..', 'frontend-dist');

const run = () => {
  execSync('npm install', { stdio: 'inherit', cwd: frontendDir });
  execSync('npm run build', { stdio: 'inherit', cwd: frontendDir });

  if (fs.existsSync(backendDist)) {
    fs.rmSync(backendDist, { recursive: true, force: true });
  }
  fs.mkdirSync(backendDist, { recursive: true });

  const distDir = path.join(frontendDir, 'dist');
  fs.cpSync(distDir, backendDist, { recursive: true });
};

run();
