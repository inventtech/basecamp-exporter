/** Subset of the Basecamp API objects we read. Fields not listed are ignored. */

export interface BasecampPerson {
  id: number;
  name: string;
  email_address?: string;
}

/** A `bucket` is the project a recording belongs to. */
export interface BasecampBucket {
  id: number;
  name: string;
  type: string;
}

/** For a To-do, `parent` is the To-do list that contains it. */
export interface BasecampParent {
  id: number;
  title: string;
  type: string;
  url?: string;
  app_url?: string;
}

/** A Basecamp To-do as returned by the recordings endpoint (`type=Todo`). */
export interface BasecampTodo {
  id: number;
  status: string;
  type: string;
  title: string;
  content?: string;
  description?: string;
  created_at: string;
  updated_at: string;
  completed: boolean;
  due_on: string | null;
  starts_on?: string | null;
  assignees?: BasecampPerson[];
  creator?: BasecampPerson;
  bucket: BasecampBucket;
  parent?: BasecampParent;
  url: string;
  app_url: string;
}
