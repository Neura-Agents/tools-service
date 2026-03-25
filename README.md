# Tools & Knowledge Service

The **Tools Service** is the intelligence and skill management hub for the AgenticAI platform. It orchestrates the lifecycle of tools, MCP servers, and knowledge bases (RAG), enabling agents to interact with the world and process information effectively.

---

## 🚀 Key Features

- **Tool Management**: Unified registry and execution for external tools and MCP servers.
- **Knowledge Base (RAG)**: Full document ingestion pipeline (PDF parsing, text splitting) with PostgreSQL vector storage.
- **Knowledge Graph**: Integration with Neo4j to manage complex relationships and graph-based reasoning.
- **Workflow Orchestration**: Powered by **Temporal** for reliable, fault-tolerant execution of long-running tasks.
- **LangChain Integration**: Advanced LLM capabilities for tool usage and knowledge retrieval.
- **Schema Management**: Automated generation and validation of tool schemas for various LLM providers (Gemini, Claude, GPT).

---

## 🛠 Technology Stack

- **Frameworks**: Express, LangChain
- **Orchestration**: Temporal SDK
- **Data Stores**: PostgreSQL (with PGVector), Neo4j
- **Processing**: Multer, pdf-parse
- **Language**: TypeScript

---

## 📥 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- PostgreSQL (with `pgvector` extension)
- Neo4j instance
- Temporal server (running locally or via Cloud)

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables in a `.env` file.

### Development

Run the API server:
```bash
npm run dev
```

Run the Temporal worker:
```bash
npm run worker
```

### Production

1. Build code:
   ```bash
   npm run build
   ```

2. Start the compiled JavaScript:
   ```bash
   npm start
   ```

---

## 🏗 Architecture

- **`src/index.ts`**: Express server entry point.
- **`src/temporal/`**: Workflows and activities for reliable tool and ingestion task execution.
- **`src/services/`**: Integration logic for Knowledge Base, Graph, and MCP servers.
- **`src/routes/`**: API endpoint definitions.
- **`src/controllers/`**: HTTP request handlers.
