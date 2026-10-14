/** Public project fields. The API-key digest never leaves the repository. */
export interface Project {
  id: string;
  name: string;
  apiKeyPrefix: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectInput {
  name: string;
}

export interface CreatedProject {
  project: Project;
  /** Returned once; callers must store this secret securely. */
  apiKey: string;
}
