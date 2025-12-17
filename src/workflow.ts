type ActionHandler<TContext = any> = (context: TContext) => Promise<void> | void;

// Function that detects which node the workflow should be at based on browser state
export type NodeDetector = () => Promise<string>;

interface Action<TContext = any> {
  name: string;
  handler: ActionHandler<TContext>;
  nextNodeId: string | null;
}

export class BaseNode<TContext = any> {
  public readonly id: string;
  protected actions: Map<string, Action<TContext>> = new Map();

  constructor(id: string) {
    this.id = id;
  }

  addAction(
    name: string,
    handler: ActionHandler<TContext>,
    nextNodeId: string | null
  ): this {
    this.actions.set(name, { name, handler, nextNodeId });
    return this;
  }

  getAction(name: string): Action<TContext> | undefined {
    return this.actions.get(name);
  }

  getAvailableActions(): string[] {
    return Array.from(this.actions.keys());
  }
}

// Function that determines the next action based on context/state
// Receives both the context and the node itself (to call check actions)
export type ActionResolver<TContext = any> = (
  context: TContext,
  node: Node<TContext>
) => Promise<string | null>;

export class Node<TContext = any> extends BaseNode<TContext> {
  private baseNode: BaseNode<TContext> | null;
  private actionResolver: ActionResolver<TContext> | null = null;

  constructor(id: string, baseNode?: BaseNode<TContext>) {
    super(id);
    this.baseNode = baseNode ?? null;
  }

  setActionResolver(resolver: ActionResolver<TContext>): this {
    this.actionResolver = resolver;
    return this;
  }

  // Determine which action to run based on current state
  async determineAction(context: TContext): Promise<string | null> {
    if (this.actionResolver) {
      return await this.actionResolver(context, this);
    }
    return null;
  }

  getAction(name: string): Action<TContext> | undefined {
    return this.actions.get(name) ?? this.baseNode?.getAction(name);
  }

  getAvailableActions(): string[] {
    const ownActions = Array.from(this.actions.keys());
    const baseActions = this.baseNode?.getAvailableActions() ?? [];
    return [...new Set([...ownActions, ...baseActions])];
  }

  // Run a specific action with the given context
  async runAction<T extends TContext>(actionName: string, context: T): Promise<string | null> {
    const action = this.getAction(actionName);
    if (!action) {
      throw new Error(`Action "${actionName}" not found on node "${this.id}"`);
    }

    await action.handler(context);
    return action.nextNodeId;
  }
}

export class Workflow<TContext = any> {
  private nodes: Map<string, Node<TContext>> = new Map();
  private startNodeId: string | null = null;
  private nodeDetector: NodeDetector | null = null;

  addNode(node: Node<TContext>): this {
    this.nodes.set(node.id, node);
    if (!this.startNodeId) {
      this.startNodeId = node.id;
    }
    return this;
  }

  setStartNode(nodeId: string): this {
    this.startNodeId = nodeId;
    return this;
  }

  setNodeDetector(detector: NodeDetector): this {
    this.nodeDetector = detector;
    return this;
  }

  getNode(nodeId: string): Node<TContext> | undefined {
    return this.nodes.get(nodeId);
  }

  getStartNode(): Node<TContext> | undefined {
    return this.startNodeId ? this.nodes.get(this.startNodeId) : undefined;
  }

  // Detect current node based on browser state
  async detectCurrentNode(): Promise<Node<TContext> | undefined> {
    if (!this.nodeDetector) {
      throw new Error('No node detector configured for this workflow');
    }
    const nodeId = await this.nodeDetector();
    return this.nodes.get(nodeId);
  }
}

export class WorkflowRunner<TContext = any> {
  private workflow: Workflow<TContext>;
  private currentNode: Node<TContext> | null = null;
  private context: TContext;

  constructor(workflow: Workflow<TContext>, context: TContext) {
    this.workflow = workflow;
    this.context = context;
  }

  start(): Node<TContext> | undefined {
    this.currentNode = this.workflow.getStartNode() ?? null;
    return this.currentNode ?? undefined;
  }

  getCurrentNode(): Node<TContext> | null {
    return this.currentNode;
  }

  getContext(): TContext {
    return this.context;
  }

  async executeAction(actionName: string): Promise<Node<TContext> | null> {
    if (!this.currentNode) {
      throw new Error('Workflow not started');
    }

    const action = this.currentNode.getAction(actionName);
    if (!action) {
      throw new Error(`Action "${actionName}" not found`);
    }

    await action.handler(this.context);

    if (action.nextNodeId === null) {
      this.currentNode = null;
      return null;
    }

    const nextNode = this.workflow.getNode(action.nextNodeId);
    if (!nextNode) {
      throw new Error(`Node "${action.nextNodeId}" not found`);
    }

    this.currentNode = nextNode;
    return nextNode;
  }

  async runToCompletion(): Promise<void> {
    while (this.currentNode) {
      const actions = this.currentNode.getAvailableActions();
      if (actions.length === 0) break;
      await this.executeAction(actions[0]);
    }
  }
}

type WorkflowFactory<TContext = any> = () => Workflow<TContext>;

export class WorkflowManager {
  private workflows: Map<string, WorkflowFactory<any>> = new Map();
  private activeRunners: Map<string, WorkflowRunner<any>> = new Map();

  register<TContext>(name: string, factory: WorkflowFactory<TContext>): this {
    this.workflows.set(name, factory);
    return this;
  }

  // Get the current node for a workflow based on browser state
  async getCurrentNode<TContext>(name: string): Promise<Node<TContext> | undefined> {
    const factory = this.workflows.get(name);
    if (!factory) {
      throw new Error(`Workflow "${name}" not registered`);
    }

    const workflow = factory();
    return await workflow.detectCurrentNode();
  }

  async run<TContext>(name: string, context: TContext, startNodeId?: string): Promise<void> {
    const factory = this.workflows.get(name);
    if (!factory) {
      throw new Error(`Workflow "${name}" not registered`);
    }

    const workflow = factory();
    if (startNodeId) {
      workflow.setStartNode(startNodeId);
    }

    const runner = new WorkflowRunner(workflow, context);
    this.activeRunners.set(name, runner);

    runner.start();
    try {
      await runner.runToCompletion();
    } finally {
      this.activeRunners.delete(name);
    }
  }

  getActiveRunner<TContext>(name: string): WorkflowRunner<TContext> | undefined {
    return this.activeRunners.get(name);
  }

  isRunning(name: string): boolean {
    return this.activeRunners.has(name);
  }

  isAnyRunning(): boolean {
    return this.activeRunners.size > 0;
  }
}

export const workflowManager = new WorkflowManager();
