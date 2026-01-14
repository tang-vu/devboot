// Project templates for quick setup

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  commands: string[];
  envVars: Record<string, string>;
}

export const projectTemplates: ProjectTemplate[] = [
  {
    id: 'python-bot',
    name: 'Python Bot',
    description: 'Discord, Telegram, or other Python bots',
    commands: [
      'source .venv/Scripts/activate',
      'python main.py',
    ],
    envVars: {
      PYTHONUNBUFFERED: '1',
    },
  },
  {
    id: 'node-api',
    name: 'Node.js API',
    description: 'Express, Fastify, or NestJS backend',
    commands: [
      'npm install',
      'npm run dev',
    ],
    envVars: {
      NODE_ENV: 'development',
    },
  },
  {
    id: 'react-app',
    name: 'React / Next.js',
    description: 'React, Next.js, or Vite frontend',
    commands: [
      'npm install',
      'npm run dev',
    ],
    envVars: {},
  },
  {
    id: 'docker',
    name: 'Docker Compose',
    description: 'Multi-container Docker apps',
    commands: [
      'docker-compose up',
    ],
    envVars: {},
  },
  {
    id: 'rust',
    name: 'Rust Project',
    description: 'Cargo-based Rust applications',
    commands: [
      'cargo run',
    ],
    envVars: {},
  },
  {
    id: 'custom',
    name: 'Custom / Manual',
    description: 'Start from scratch with custom commands',
    commands: [],
    envVars: {},
  },
];
