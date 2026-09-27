export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Point2 {
  x: number;
  y: number;
}

export interface Transform3D {
  parentFrameId: string;
  translationM: Vec3;
  rotationRad: Vec3;
}

export interface RobotBody {
  dimensionsM: { x: number; y: number; z: number } | null;
  footprintM: Point2[];
  [key: string]: unknown;
}

export interface RobotController {
  id: string;
  boardDefinitionId: string | null;
  [key: string]: unknown;
}

export interface RobotDrive {
  type: string;
  feedback: 'none' | 'encoder';
  motorModel: string;
  leftMotorIds: string[];
  rightMotorIds: string[];
  effectiveTrackWidthM: number | null;
  limits?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface RobotWheel {
  id: string;
  role: string;
  motorId: string;
  mount: Transform3D | null;
  radiusM: number | null;
  widthM?: number | null;
  encoderId?: string | null;
  [key: string]: unknown;
}

export interface RobotMotor {
  id: string;
  driverChannelRef: string | null;
  driveGroup?: string | null;
  inverted?: boolean;
  outputLimit?: number | null;
  [key: string]: unknown;
}

export interface RobotSensor {
  id: string;
  kind: string;
  model: string;
  frameId: string;
  mount: Transform3D | null;
  connection: Record<string, unknown> | null;
  variantVerified?: boolean;
  [key: string]: unknown;
}

export interface RobotDriverBoard {
  id: string;
  interfaceKind: string;
  channels: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface RobotDefinition {
  schemaVersion: string;
  id: string;
  name: string;
  revision: number;
  status: 'draft' | 'configured';
  templateId?: string | null;
  units: 'SI';
  baseFrameId: string;
  body: RobotBody;
  controllers: RobotController[];
  drive: RobotDrive;
  wheels: RobotWheel[];
  motors: RobotMotor[];
  sensors: RobotSensor[];
  driverBoards: RobotDriverBoard[];
  calibration?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export type RobotRole =
  | 'chassis'
  | 'wheel'
  | 'servo'
  | 'linear_actuator'
  | 'lidar'
  | 'imu'
  | 'camera'
  | 'ultrasonic'
  | 'structural';

export interface InstanceRoboticsConfig {
  instanceId: string;
  instanceName: string;
  role: RobotRole;
  frameId: string;
  parentFrameId: string;
  // Actuator/Servo options
  jointName?: string;
  channelPin?: string;
  limitsDeg?: [number, number];
  inverted?: boolean;
  // Wheel options
  wheelRole?: 'front_left' | 'front_right' | 'rear_left' | 'rear_right' | 'left' | 'right' | 'caster_front' | 'caster_rear';
  radiusM?: number;
  widthM?: number;
  // Sensor options
  sensorKind?: string;
  sensorModel?: string;
}
