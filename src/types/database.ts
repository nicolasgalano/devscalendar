export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          diff: Json;
          entity: string;
          entity_id: string;
          id: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          diff: Json;
          entity: string;
          entity_id: string;
          id?: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          diff?: Json;
          entity?: string;
          entity_id?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: {
          created_at: string;
          created_by: string | null;
          dev_id: string;
          ends_at: string;
          id: string;
          note: string | null;
          project_id: string;
          responded_at: string | null;
          response_note: string | null;
          starts_at: string;
          status: string;
          ticket_ref: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          dev_id: string;
          ends_at: string;
          id?: string;
          note?: string | null;
          project_id: string;
          responded_at?: string | null;
          response_note?: string | null;
          starts_at: string;
          status?: string;
          ticket_ref?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          dev_id?: string;
          ends_at?: string;
          id?: string;
          note?: string | null;
          project_id?: string;
          responded_at?: string | null;
          response_note?: string | null;
          starts_at?: string;
          status?: string;
          ticket_ref?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_dev_id_fkey";
            columns: ["dev_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      clients: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          booking_id: string | null;
          created_at: string;
          email_attempts: number;
          email_error: string | null;
          email_sent_at: string | null;
          email_status: string;
          id: string;
          payload: Json;
          read_at: string | null;
          recipient_id: string;
          ticket_id: string | null;
          type: string;
        };
        Insert: {
          booking_id?: string | null;
          created_at?: string;
          email_attempts?: number;
          email_error?: string | null;
          email_sent_at?: string | null;
          email_status?: string;
          id?: string;
          payload?: Json;
          read_at?: string | null;
          recipient_id: string;
          ticket_id?: string | null;
          type: string;
        };
        Update: {
          booking_id?: string | null;
          created_at?: string;
          email_attempts?: number;
          email_error?: string | null;
          email_sent_at?: string | null;
          email_status?: string;
          id?: string;
          payload?: Json;
          read_at?: string | null;
          recipient_id?: string;
          ticket_id?: string | null;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      profile_invites: {
        Row: {
          created_at: string;
          email: string;
          invited_by: string | null;
          roles: Database["public"]["Enums"]["user_role"][];
        };
        Insert: {
          created_at?: string;
          email: string;
          invited_by?: string | null;
          roles: Database["public"]["Enums"]["user_role"][];
        };
        Update: {
          created_at?: string;
          email?: string;
          invited_by?: string | null;
          roles?: Database["public"]["Enums"]["user_role"][];
        };
        Relationships: [
          {
            foreignKeyName: "profile_invites_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          active: boolean;
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          primary_pm_id: string | null;
          roles: Database["public"]["Enums"]["user_role"][];
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          avatar_url?: string | null;
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          primary_pm_id?: string | null;
          roles?: Database["public"]["Enums"]["user_role"][];
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          avatar_url?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          primary_pm_id?: string | null;
          roles?: Database["public"]["Enums"]["user_role"][];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_primary_pm_id_fkey";
            columns: ["primary_pm_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      project_members: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          project_id: string;
          role_in_project: Database["public"]["Enums"]["project_member_role"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          project_id: string;
          role_in_project?: Database["public"]["Enums"]["project_member_role"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          project_id?: string;
          role_in_project?: Database["public"]["Enums"]["project_member_role"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          active: boolean;
          client_id: string;
          created_at: string;
          id: string;
          jira_enabled: boolean;
          key: string;
          name: string;
          next_sprint_number: number;
          next_ticket_number: number;
          pm_id: string;
          priority: string;
          slack_enabled: boolean;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          client_id: string;
          created_at?: string;
          id?: string;
          jira_enabled?: boolean;
          key: string;
          name: string;
          next_sprint_number?: number;
          next_ticket_number?: number;
          pm_id: string;
          priority?: string;
          slack_enabled?: boolean;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          client_id?: string;
          created_at?: string;
          id?: string;
          jira_enabled?: boolean;
          key?: string;
          name?: string;
          next_sprint_number?: number;
          next_ticket_number?: number;
          pm_id?: string;
          priority?: string;
          slack_enabled?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_pm_id_fkey";
            columns: ["pm_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      sprints: {
        Row: {
          closed_at: string | null;
          created_at: string;
          ends_at: string;
          goal: string | null;
          id: string;
          name: string | null;
          numero: number;
          project_id: string;
          report: Json | null;
          starts_at: string;
          status: Database["public"]["Enums"]["sprint_status"];
          updated_at: string;
        };
        Insert: {
          closed_at?: string | null;
          created_at?: string;
          ends_at: string;
          goal?: string | null;
          id?: string;
          name?: string | null;
          numero: number;
          project_id: string;
          report?: Json | null;
          starts_at: string;
          status?: Database["public"]["Enums"]["sprint_status"];
          updated_at?: string;
        };
        Update: {
          closed_at?: string | null;
          created_at?: string;
          ends_at?: string;
          goal?: string | null;
          id?: string;
          name?: string | null;
          numero?: number;
          project_id?: string;
          report?: Json | null;
          starts_at?: string;
          status?: Database["public"]["Enums"]["sprint_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sprints_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      tickets: {
        Row: {
          assignee_id: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          estimated_hours: number | null;
          id: string;
          numero: number;
          priority: Database["public"]["Enums"]["ticket_priority"];
          project_id: string;
          sprint_id: string | null;
          status: Database["public"]["Enums"]["ticket_status"];
          title: string;
          updated_at: string;
        };
        Insert: {
          assignee_id?: string | null;
          created_at?: string;
          created_by: string;
          description?: string | null;
          estimated_hours?: number | null;
          id?: string;
          numero: number;
          priority?: Database["public"]["Enums"]["ticket_priority"];
          project_id: string;
          sprint_id?: string | null;
          status?: Database["public"]["Enums"]["ticket_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          assignee_id?: string | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          estimated_hours?: number | null;
          id?: string;
          numero?: number;
          priority?: Database["public"]["Enums"]["ticket_priority"];
          project_id?: string;
          sprint_id?: string | null;
          status?: Database["public"]["Enums"]["ticket_status"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tickets_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_sprint_id_fkey";
            columns: ["sprint_id"];
            isOneToOne: false;
            referencedRelation: "sprints";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      can_manage_booking: { Args: { target_project: string }; Returns: boolean };
      can_view_project: {
        Args: { p_project_id: string; p_user_id?: string };
        Returns: boolean;
      };
      close_sprint_with_rollover: {
        Args: { p_next_sprint_id: string; p_sprint_id: string };
        Returns: Json;
      };
      has_any_role: { Args: never; Returns: boolean };
      has_role: {
        Args: { target: Database["public"]["Enums"]["user_role"] };
        Returns: boolean;
      };
      is_admin: { Args: { p_user_id?: string }; Returns: boolean };
      is_pm_of_project: {
        Args: { p_project_id: string; p_user_id?: string };
        Returns: boolean;
      };
      is_project_member: {
        Args: { p_project_id: string; p_user_id?: string };
        Returns: boolean;
      };
      mark_notifications_read: { Args: { ids: string[] }; Returns: number };
      notify_user: {
        Args: {
          notification_payload: Json;
          notification_type: string;
          target_booking: string;
          target_recipient: string;
        };
        Returns: undefined;
      };
      notify_user_for_ticket: {
        Args: {
          notification_payload: Json;
          notification_type: string;
          target_recipient: string;
          target_ticket: string;
        };
        Returns: undefined;
      };
      reallocate_booking: {
        Args: {
          booking_note?: string;
          confirmed_displacing: string[];
          ends: string;
          starts: string;
          target_dev: string;
          target_project: string;
          ticket?: string;
        };
        Returns: Json;
      };
      role_in_project: {
        Args: { p_project_id: string; p_user_id?: string };
        Returns: Database["public"]["Enums"]["project_member_role"];
      };
    };
    Enums: {
      project_member_role: "viewer" | "contributor" | "lead";
      sprint_status: "planned" | "active" | "completed";
      ticket_priority: "low" | "medium" | "high" | "critical";
      ticket_status: "todo" | "in_progress" | "in_review" | "blocked" | "done" | "cancelled";
      user_role: "admin" | "pm" | "developer";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      project_member_role: ["viewer", "contributor", "lead"],
      sprint_status: ["planned", "active", "completed"],
      ticket_priority: ["low", "medium", "high", "critical"],
      ticket_status: ["todo", "in_progress", "in_review", "blocked", "done", "cancelled"],
      user_role: ["admin", "pm", "developer"],
    },
  },
} as const;
