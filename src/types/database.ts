// Placeholder for generated Supabase types.
// Regenerate with: `pnpm db:types` once Supabase is connected.
// Docs: https://supabase.com/docs/guides/api/rest/generating-types

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type UserRole = "admin" | "pm" | "developer";

export type Database = {
  // Required by @supabase/postgrest-js ≥ 2.x to enable typed select() inference.
  // Regenerating with `pnpm db:types` will populate this with the runtime version.
  __InternalSupabase: {
    PostgrestVersion: string;
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          role: UserRole | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          role?: UserRole | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          role?: UserRole | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      current_user_role: {
        Args: Record<string, never>;
        Returns: UserRole | null;
      };
    };
    Enums: {
      user_role: UserRole;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
