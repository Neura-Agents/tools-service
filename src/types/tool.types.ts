export interface ToolParameter {
    id?: string;
    tool_id?: string;
    name: string;
    in: 'query' | 'path' | 'header' | 'body';
    required: boolean;
    type: string;
    description: string;
    item_type?: string;
    children?: ToolParameter[];
}

export interface Tool {
    id: string;
    name: string;
    description: string;
    method: string;
    baseUrl: string;
    path: string;
    authType: string;
    authDetails?: any;
    user_id: string;
    visibility: 'public' | 'private';
    parameters: ToolParameter[];
    icon?: string;
    created_at?: Date;
    updated_at?: Date;
}
