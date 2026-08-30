export interface Task {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TaskData {
  notePath: string;
  tasks: Task[];
}
