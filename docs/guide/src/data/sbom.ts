export interface SbomEntry {
  name: string;
  version: string;
  license: string;
  category: 'Frontend' | 'Backend' | 'Database' | 'Infrastructure' | 'Dev Tooling';
  description: string;
}

export const sbomData: SbomEntry[] = [
  // Frontend
  { name: 'React', version: '19.x', license: 'MIT', category: 'Frontend', description: 'UI component library' },
  { name: 'React DOM', version: '19.x', license: 'MIT', category: 'Frontend', description: 'React renderer for the browser' },
  { name: 'TypeScript', version: '5.x', license: 'Apache-2.0', category: 'Frontend', description: 'Typed superset of JavaScript' },
  { name: 'Vite', version: '7.x', license: 'MIT', category: 'Frontend', description: 'Fast build tool and dev server' },
  { name: 'Zustand', version: '5.x', license: 'MIT', category: 'Frontend', description: 'Lightweight state management' },
  { name: 'Tailwind CSS', version: '4.x', license: 'MIT', category: 'Frontend', description: 'Utility-first CSS framework' },
  { name: 'React Router', version: '7.x', license: 'MIT', category: 'Frontend', description: 'Client-side routing' },
  { name: 'Lucide React', version: '0.x', license: 'ISC', category: 'Frontend', description: 'Icon library for React' },
  { name: 'Recharts', version: '3.x', license: 'MIT', category: 'Frontend', description: 'Composable charting library' },
  { name: 'PrismJS', version: '1.x', license: 'MIT', category: 'Frontend', description: 'Syntax highlighting' },
  { name: 'Mermaid', version: '11.x', license: 'MIT', category: 'Frontend', description: 'Diagram and chart rendering' },
  { name: 'date-fns', version: '4.x', license: 'MIT', category: 'Frontend', description: 'Date utility functions' },
  { name: 'clsx', version: '2.x', license: 'MIT', category: 'Frontend', description: 'Conditional className utility' },
  { name: 'tailwind-merge', version: '3.x', license: 'MIT', category: 'Frontend', description: 'Merge Tailwind classes intelligently' },
  { name: 'jsPDF', version: '2.x', license: 'MIT', category: 'Frontend', description: 'Client-side PDF generation' },
  { name: 'react-markdown', version: '9.x', license: 'MIT', category: 'Frontend', description: 'Markdown renderer for React' },
  { name: 'sonner', version: '2.x', license: 'MIT', category: 'Frontend', description: 'Toast notification library' },
  { name: 'wavesurfer.js', version: '7.x', license: 'BSD-3-Clause', category: 'Frontend', description: 'Audio waveform visualization' },

  // Backend
  { name: 'FastAPI', version: '0.115.x', license: 'MIT', category: 'Backend', description: 'Async Python web framework' },
  { name: 'Uvicorn', version: '0.34.x', license: 'BSD-3-Clause', category: 'Backend', description: 'ASGI server for FastAPI' },
  { name: 'SQLAlchemy', version: '2.x', license: 'MIT', category: 'Backend', description: 'Async ORM with Python type support' },
  { name: 'asyncpg', version: '0.30.x', license: 'Apache-2.0', category: 'Backend', description: 'PostgreSQL async driver' },
  { name: 'Pydantic', version: '2.x', license: 'MIT', category: 'Backend', description: 'Data validation and settings' },
  { name: 'Python', version: '3.12', license: 'PSF-2.0', category: 'Backend', description: 'Programming language runtime' },
  { name: 'google-genai', version: '1.x', license: 'Apache-2.0', category: 'Backend', description: 'Google Gemini AI SDK' },
  { name: 'openai', version: '1.x', license: 'Apache-2.0', category: 'Backend', description: 'OpenAI API client' },
  { name: 'anthropic', version: '0.x', license: 'MIT', category: 'Backend', description: 'Anthropic Claude API client' },
  { name: 'httpx', version: '0.28.x', license: 'BSD-3-Clause', category: 'Backend', description: 'Async HTTP client' },
  { name: 'python-multipart', version: '0.0.x', license: 'Apache-2.0', category: 'Backend', description: 'Multipart form data parsing' },
  { name: 'aiofiles', version: '24.x', license: 'Apache-2.0', category: 'Backend', description: 'Async file operations' },

  // Database
  { name: 'PostgreSQL', version: '16', license: 'PostgreSQL', category: 'Database', description: 'Relational database with JSONB support' },

  // Infrastructure
  { name: 'Docker', version: '27.x', license: 'Apache-2.0', category: 'Infrastructure', description: 'Container runtime' },
  { name: 'Docker Compose', version: '2.x', license: 'Apache-2.0', category: 'Infrastructure', description: 'Multi-container orchestration' },
  { name: 'Nginx', version: '1.27.x', license: 'BSD-2-Clause', category: 'Infrastructure', description: 'Reverse proxy and static file server' },
  { name: 'Azure App Service', version: 'N/A', license: 'Proprietary', category: 'Infrastructure', description: 'Cloud hosting platform' },
  { name: 'Azure Database for PostgreSQL', version: '16', license: 'Proprietary', category: 'Infrastructure', description: 'Managed PostgreSQL service' },

  // Dev Tooling
  { name: 'ESLint', version: '9.x', license: 'MIT', category: 'Dev Tooling', description: 'JavaScript/TypeScript linter' },
  { name: 'PostCSS', version: '8.x', license: 'MIT', category: 'Dev Tooling', description: 'CSS transformation tool' },
  { name: 'Autoprefixer', version: '10.x', license: 'MIT', category: 'Dev Tooling', description: 'Vendor prefix automation' },
  { name: '@vitejs/plugin-react', version: '4.x', license: 'MIT', category: 'Dev Tooling', description: 'Vite React plugin with Fast Refresh' },
  { name: 'typescript-eslint', version: '8.x', license: 'MIT', category: 'Dev Tooling', description: 'TypeScript ESLint integration' },
  { name: 'pyenv', version: 'N/A', license: 'MIT', category: 'Dev Tooling', description: 'Python version management' },
  { name: 'pip', version: '24.x', license: 'MIT', category: 'Dev Tooling', description: 'Python package installer' },
  { name: 'Playwright MCP', version: 'N/A', license: 'Apache-2.0', category: 'Dev Tooling', description: 'Browser automation for testing' },
];

export const sbomCategories = ['All', 'Frontend', 'Backend', 'Database', 'Infrastructure', 'Dev Tooling'] as const;
