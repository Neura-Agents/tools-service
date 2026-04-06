import { Pool } from 'pg';
import { ENV } from './env.config';

// 🚀 CI/CD Automated Trigger Test - 2026-04-06 19:08

export const pool = new Pool({
    host: ENV.DB.HOST,
    port: ENV.DB.PORT,
    user: ENV.DB.USER,
    password: ENV.DB.PASSWORD,
    database: ENV.DB.NAME,
    options: `-c search_path=${ENV.DB.SCHEMA},public`,
});

export const initDb = async () => {
    try {
        await pool.query(`
            CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
            CREATE EXTENSION IF NOT EXISTS vector;

            CREATE TABLE IF NOT EXISTS tools (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL,
                description TEXT,
                method VARCHAR(10) NOT NULL,
                base_url VARCHAR(255),
                path VARCHAR(255) NOT NULL,
                auth_type VARCHAR(50) NOT NULL,
                auth_details JSONB DEFAULT '{}',
                user_id VARCHAR(255) NOT NULL,
                visibility VARCHAR(20) DEFAULT 'private',
                icon VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS tool_parameters (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tool_id UUID REFERENCES tools(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                location VARCHAR(50) NOT NULL, -- query, path, header, body
                required BOOLEAN DEFAULT FALSE,
                type VARCHAR(50) DEFAULT 'string',
                description TEXT,
                item_type VARCHAR(50),
                parent_id UUID REFERENCES tool_parameters(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Index for performance and duplication check
            CREATE INDEX IF NOT EXISTS idx_tools_user_path_method ON tools(user_id, path, method);
            CREATE INDEX IF NOT EXISTS idx_tools_user_name ON tools(user_id, name);

            CREATE TABLE IF NOT EXISTS knowledge_bases (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                status VARCHAR(50) DEFAULT 'active',
                visibility VARCHAR(20) DEFAULT 'private',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS knowledge_graphs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                node_count INTEGER DEFAULT 0,
                relation_count INTEGER DEFAULT 0,
                status VARCHAR(50) DEFAULT 'active',
                visibility VARCHAR(20) DEFAULT 'private',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS knowledge_documents (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                knowledge_id UUID NOT NULL,
                knowledge_type VARCHAR(20) NOT NULL,
                storage_id UUID NOT NULL,
                file_name VARCHAR(255) NOT NULL,
                file_size BIGINT,
                file_type VARCHAR(100),
                file_url TEXT,
                status VARCHAR(50) DEFAULT 'pending',
                processed_chunks INTEGER DEFAULT 0,
                total_chunks INTEGER DEFAULT 0,
                error_message TEXT,
                uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS knowledge_embeddings (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                knowledge_id UUID NOT NULL,
                document_id UUID REFERENCES knowledge_documents(id) ON DELETE CASCADE,
                content TEXT NOT NULL,
                embedding vector(2048),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                knowledge_id UUID NOT NULL,
                document_id UUID REFERENCES knowledge_documents(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                type VARCHAR(255),
                properties JSONB DEFAULT '{}',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (knowledge_id, name)
            );

            CREATE TABLE IF NOT EXISTS knowledge_graph_relations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                knowledge_id UUID NOT NULL,
                document_id UUID REFERENCES knowledge_documents(id) ON DELETE CASCADE,
                from_node_id UUID REFERENCES knowledge_graph_nodes(id) ON DELETE CASCADE,
                to_node_id UUID REFERENCES knowledge_graph_nodes(id) ON DELETE CASCADE,
                relation_type VARCHAR(255) NOT NULL,
                properties JSONB DEFAULT '{}',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS uningested_pipeline (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                knowledge_id UUID NOT NULL,
                document_id UUID NOT NULL,
                file_name VARCHAR(255) NOT NULL,
                error_message TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS mcp_tools (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                server_id VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                input_schema JSONB DEFAULT '{}',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (server_id, name)
            );

            CREATE TABLE IF NOT EXISTS mcp_servers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                server_id VARCHAR(255) UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                alias VARCHAR(255),
                description TEXT,
                status VARCHAR(50) DEFAULT 'active',
                transport VARCHAR(20) DEFAULT 'http',
                url TEXT,
                auth_type VARCHAR(50) DEFAULT 'none',
                user_id VARCHAR(255) DEFAULT 'system',
                visibility VARCHAR(20) DEFAULT 'public',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            -- Alter table if column doesn't exist for existing DBs
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='knowledge_documents' AND column_name='file_url') THEN
                    ALTER TABLE knowledge_documents ADD COLUMN file_url TEXT;
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='knowledge_documents' AND column_name='status') THEN
                    ALTER TABLE knowledge_documents ADD COLUMN status VARCHAR(50) DEFAULT 'pending';
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='knowledge_documents' AND column_name='error_message') THEN
                    ALTER TABLE knowledge_documents ADD COLUMN error_message TEXT;
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='knowledge_documents' AND column_name='processed_chunks') THEN
                    ALTER TABLE knowledge_documents ADD COLUMN processed_chunks INTEGER DEFAULT 0;
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='knowledge_documents' AND column_name='total_chunks') THEN
                    ALTER TABLE knowledge_documents ADD COLUMN total_chunks INTEGER DEFAULT 0;
                END IF;
                
                -- Add visibility to tools
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tools' AND column_name='visibility') THEN
                    ALTER TABLE tools ADD COLUMN visibility VARCHAR(20) DEFAULT 'private';
                END IF;

                -- Add visibility to knowledge_bases
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='knowledge_bases' AND column_name='visibility') THEN
                    ALTER TABLE knowledge_bases ADD COLUMN visibility VARCHAR(20) DEFAULT 'private';
                END IF;

                -- Add visibility to knowledge_graphs
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='knowledge_graphs' AND column_name='visibility') THEN
                    ALTER TABLE knowledge_graphs ADD COLUMN visibility VARCHAR(20) DEFAULT 'private';
                END IF;

                -- Add user_id and visibility to mcp_servers
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mcp_servers' AND column_name='user_id') THEN
                    ALTER TABLE mcp_servers ADD COLUMN user_id VARCHAR(255) DEFAULT 'system';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mcp_servers' AND column_name='visibility') THEN
                    ALTER TABLE mcp_servers ADD COLUMN visibility VARCHAR(20) DEFAULT 'public';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mcp_servers' AND column_name='alias') THEN
                    ALTER TABLE mcp_servers ADD COLUMN alias VARCHAR(255);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mcp_servers' AND column_name='auth_type') THEN
                    ALTER TABLE mcp_servers ADD COLUMN auth_type VARCHAR(50) DEFAULT 'none';
                END IF;

                -- Ensure correct vector dimension
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='knowledge_embeddings' AND column_name='embedding') THEN
                    ALTER TABLE knowledge_embeddings ALTER COLUMN embedding TYPE vector(2048);
                END IF;
            END $$;

            -- Populate existing null URLs from storage_metadata table
            UPDATE knowledge_documents kd
            SET file_url = sm.url
            FROM storage_metadata sm
            WHERE kd.storage_id = sm.id AND kd.file_url IS NULL;

            CREATE INDEX IF NOT EXISTS idx_kb_user_id ON knowledge_bases(user_id);
            CREATE INDEX IF NOT EXISTS idx_kg_user_id ON knowledge_graphs(user_id);
            CREATE INDEX IF NOT EXISTS idx_kd_knowledge_id ON knowledge_documents(knowledge_id);
            CREATE INDEX IF NOT EXISTS idx_mcp_servers_status ON mcp_servers(status);
            CREATE INDEX IF NOT EXISTS idx_mcp_tools_server_id ON mcp_tools(server_id);
        `);
        console.log('Knowledge database initialized and migrated successfully');
    } catch (error) {
        console.error('Failed to initialize tools database:', error);
        throw error;
    }
};
