import { Box3, Euler, Quaternion, Vector3, type Group } from 'three';
import type { SerializedAssembly, SerializedAssemblyInstance, SerializedAssemblyMate } from '../types';
import type {
  InstanceRoboticsConfig,
  RobotDefinition,
  RobotMotor,
  RobotRole,
  RobotSensor,
  RobotWheel,
  Transform3D,
  Vec3,
} from './types';

export interface CompilerAssemblySource {
  assembly: SerializedAssembly;
  getInstancePose: (instanceId: string) => { position: Vector3; quaternion: Quaternion } | null;
  getInstanceGroup: (instanceId: string) => Group | null;
}

const num = (v: number, decimals = 4): number => {
  if (!Number.isFinite(v)) return 0;
  return Number(v.toFixed(decimals));
};

export function inferDefaultConfig(
  inst: SerializedAssemblyInstance,
  isGrounded: boolean,
  allInstances: SerializedAssemblyInstance[],
  mates: SerializedAssemblyMate[],
): InstanceRoboticsConfig {
  const lowerName = (inst.name || inst.partName || '').toLowerCase();
  let role: RobotRole = 'structural';
  let frameId = `${inst.name || inst.instanceId}_link`.replace(/[^a-zA-Z0-9_]/g, '_');
  let jointName = `${inst.name || inst.instanceId}_joint`.replace(/[^a-zA-Z0-9_]/g, '_');
  let channelPin = '';
  let sensorKind = '';
  let sensorModel = '';
  let wheelRole: InstanceRoboticsConfig['wheelRole'] = undefined;
  let limitsDeg: [number, number] | undefined = undefined;

  // Check if this instance is part of a mate with limits
  const relatedMate = mates.find(
    (m) => m.connectorA.instanceId === inst.instanceId || m.connectorB.instanceId === inst.instanceId,
  );
  if (relatedMate?.options?.limits) {
    limitsDeg = [relatedMate.options.limits[0], relatedMate.options.limits[1]];
  }

  if (isGrounded || lowerName.includes('chassis') || lowerName.includes('base') || lowerName.includes('body')) {
    role = 'chassis';
    frameId = 'base_link';
  } else if (lowerName.includes('wheel') || lowerName.includes('tire') || lowerName.includes('rim')) {
    role = 'wheel';
    if (lowerName.includes('fl') || lowerName.includes('front_left') || lowerName.includes('frontleft')) {
      wheelRole = 'front_left';
    } else if (lowerName.includes('fr') || lowerName.includes('front_right') || lowerName.includes('frontright')) {
      wheelRole = 'front_right';
    } else if (lowerName.includes('rl') || lowerName.includes('rear_left') || lowerName.includes('rearleft')) {
      wheelRole = 'rear_left';
    } else if (lowerName.includes('rr') || lowerName.includes('rear_right') || lowerName.includes('rearright')) {
      wheelRole = 'rear_right';
    } else if (lowerName.includes('left')) {
      wheelRole = 'left';
    } else if (lowerName.includes('right')) {
      wheelRole = 'right';
    } else {
      wheelRole = 'left';
    }
  } else if (lowerName.includes('servo') || lowerName.includes('actuator') || relatedMate?.type === 'revolute') {
    role = 'servo';
    if (!limitsDeg) {
      limitsDeg = [-90, 90];
    }
    channelPin = 'GPIO18';
  } else if (relatedMate?.type === 'slider' || lowerName.includes('slider') || lowerName.includes('linear')) {
    role = 'linear_actuator';
    if (!limitsDeg) {
      limitsDeg = [0, 50]; // 0 to 50mm
    }
    channelPin = 'GPIO19';
  } else if (lowerName.includes('lidar') || lowerName.includes('laser') || lowerName.includes('lds') || lowerName.includes('rplidar')) {
    role = 'lidar';
    frameId = 'lidar_link';
    sensorKind = 'lidar_2d';
    sensorModel = 'xiaomi_lds02rr';
  } else if (lowerName.includes('imu') || lowerName.includes('gyro') || lowerName.includes('accel')) {
    role = 'imu';
    frameId = 'imu_link';
    sensorKind = 'imu_6axis';
    sensorModel = 'LSM6DS3TR';
  } else if (lowerName.includes('camera') || lowerName.includes('cam')) {
    role = 'camera';
    frameId = 'camera_link';
    sensorKind = 'camera_rgb';
    sensorModel = 'esp32_cam';
  } else if (lowerName.includes('sonar') || lowerName.includes('ultrasonic') || lowerName.includes('tof')) {
    role = 'ultrasonic';
    frameId = 'range_link';
    sensorKind = 'range_finder';
    sensorModel = 'hc_sr04';
  }

  return {
    instanceId: inst.instanceId,
    instanceName: inst.name || inst.partName,
    role,
    frameId,
    parentFrameId: 'base_link',
    jointName,
    channelPin,
    limitsDeg,
    wheelRole,
    sensorKind,
    sensorModel,
  };
}

export function compileRobotAssembly(
  source: CompilerAssemblySource,
  userConfigs: Map<string, InstanceRoboticsConfig>,
  robotName = 'Flow Robot',
): {
  robotDefinition: RobotDefinition;
  urdf: string;
  transforms: Map<string, Transform3D>;
} {
  const { assembly, getInstancePose, getInstanceGroup } = source;
  const instances = assembly.instances || [];
  const mates = assembly.mates || [];

  // 1. Identify Chassis / Base Link
  let chassisInst = instances.find((i) => userConfigs.get(i.instanceId)?.role === 'chassis');
  if (!chassisInst) {
    chassisInst = instances.find((i) => i.grounded) || instances[0];
  }
  const chassisId = chassisInst ? chassisInst.instanceId : '';

  // 2. Obtain Chassis Pose and Bounding Box
  const chassisPoseRaw = chassisId ? getInstancePose(chassisId) : null;
  const chassisPos = chassisPoseRaw?.position ?? new Vector3(0, 0, 0);
  const chassisQuat = chassisPoseRaw?.quaternion ?? new Quaternion(0, 0, 0, 1);
  const chassisQuatInv = chassisQuat.clone().invert();

  let chassisDims = { x: 0.35, y: 0.25, z: 0.12 };
  if (chassisId) {
    const group = getInstanceGroup(chassisId);
    if (group) {
      const box = new Box3().setFromObject(group);
      if (!box.isEmpty()) {
        const size = box.getSize(new Vector3());
        // FluidCAD operates in millimeters -> convert to meters
        chassisDims = {
          x: Math.max(0.05, num(size.x / 1000)),
          y: Math.max(0.05, num(size.y / 1000)),
          z: Math.max(0.02, num(size.z / 1000)),
        };
      }
    }
  }

  const halfL = chassisDims.x / 2;
  const halfW = chassisDims.y / 2;
  const footprintM = [
    { x: num(halfL), y: num(halfW) },
    { x: num(halfL), y: num(-halfW) },
    { x: num(-halfL), y: num(-halfW) },
    { x: num(-halfL), y: num(halfW) },
  ];

  // 3. Compute 3D relative transforms for all instances
  const transforms = new Map<string, Transform3D>();

  for (const inst of instances) {
    if (inst.instanceId === chassisId) {
      transforms.set(inst.instanceId, {
        parentFrameId: 'base_link',
        translationM: { x: 0, y: 0, z: 0 },
        rotationRad: { x: 0, y: 0, z: 0 },
      });
      continue;
    }

    const pose = getInstancePose(inst.instanceId);
    if (!pose) {
      transforms.set(inst.instanceId, {
        parentFrameId: 'base_link',
        translationM: { x: 0, y: 0, z: 0 },
        rotationRad: { x: 0, y: 0, z: 0 },
      });
      continue;
    }

    // Relative translation: (pose.pos - chassisPos) rotated by chassisQuatInv
    const relPos = pose.position.clone().sub(chassisPos).applyQuaternion(chassisQuatInv);
    // Relative rotation: chassisQuatInv * pose.quat
    const relQuat = chassisQuatInv.clone().multiply(pose.quaternion);
    const euler = new Euler().setFromQuaternion(relQuat, 'XYZ');

    transforms.set(inst.instanceId, {
      parentFrameId: 'base_link',
      translationM: {
        x: num(relPos.x / 1000),
        y: num(relPos.y / 1000),
        z: num(relPos.z / 1000),
      },
      rotationRad: {
        x: num(euler.x),
        y: num(euler.y),
        z: num(euler.z),
      },
    });
  }

  // 4. Build Components: Wheels, Motors, Sensors, Actuators
  const wheels: RobotWheel[] = [];
  const motors: RobotMotor[] = [];
  const sensors: RobotSensor[] = [];

  const leftMotorIds: string[] = [];
  const rightMotorIds: string[] = [];

  let motorIdx = 1;

  for (const inst of instances) {
    if (inst.instanceId === chassisId) continue;

    const conf = userConfigs.get(inst.instanceId) || inferDefaultConfig(inst, false, instances, mates);
    const mount = transforms.get(inst.instanceId) || null;

    // Estimate part dimensions for wheels / radius
    let measuredRadius = 0.035;
    let measuredWidth = 0.025;
    const group = getInstanceGroup(inst.instanceId);
    if (group) {
      const box = new Box3().setFromObject(group);
      if (!box.isEmpty()) {
        const size = box.getSize(new Vector3());
        measuredRadius = num(Math.max(size.y, size.z) / 2000);
        measuredWidth = num(size.x / 1000);
      }
    }

    if (conf.role === 'wheel') {
      const motorId = `motor-${conf.wheelRole || inst.name || inst.instanceId}`;
      const wheelId = `wheel-${conf.wheelRole || inst.name || inst.instanceId}`;
      const isRight = (conf.wheelRole || '').includes('right') || (mount?.translationM.y ?? 0) < 0;

      if (isRight) {
        rightMotorIds.push(motorId);
      } else {
        leftMotorIds.push(motorId);
      }

      wheels.push({
        id: wheelId,
        role: conf.wheelRole || (isRight ? 'right' : 'left'),
        motorId,
        mount,
        radiusM: conf.radiusM ?? measuredRadius,
        widthM: conf.widthM ?? measuredWidth,
      });

      motors.push({
        id: motorId,
        driverChannelRef: conf.channelPin || `ch${motorIdx++}`,
        driveGroup: isRight ? 'right' : 'left',
        inverted: conf.inverted ?? false,
      });
    } else if (conf.role === 'servo' || conf.role === 'linear_actuator') {
      const motorId = `actuator-${conf.jointName || inst.name || inst.instanceId}`;
      motors.push({
        id: motorId,
        driverChannelRef: conf.channelPin || `pwm_${motorIdx++}`,
        driveGroup: 'actuator',
        inverted: conf.inverted ?? false,
        outputLimit: conf.limitsDeg ? conf.limitsDeg[1] : 90,
      });
    } else if (
      conf.role === 'lidar' ||
      conf.role === 'imu' ||
      conf.role === 'camera' ||
      conf.role === 'ultrasonic'
    ) {
      sensors.push({
        id: `sensor-${conf.role}-${inst.name || inst.instanceId}`,
        kind: conf.sensorKind || `${conf.role}_sensor`,
        model: conf.sensorModel || 'generic',
        frameId: conf.frameId || `${conf.role}_link`,
        mount,
        connection: null,
      });
    }
  }

  const driveType = wheels.length >= 4 ? 'skid_steer_4wd' : 'diff_drive_2wd';

  // 5. Construct full RobotDefinition
  const robotDef: RobotDefinition = {
    schemaVersion: '1.0.0',
    id: robotName.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
    name: robotName,
    revision: 1,
    status: 'configured',
    units: 'SI',
    baseFrameId: 'base_link',
    body: {
      dimensionsM: chassisDims,
      footprintM,
    },
    controllers: [
      {
        id: 'main-esp32',
        boardDefinitionId: 'esp32-s3-devkitc-1',
      },
    ],
    drive: {
      type: driveType,
      feedback: 'none',
      motorModel: 'open_loop_calibrated',
      leftMotorIds,
      rightMotorIds,
      effectiveTrackWidthM: chassisDims.y,
      limits: null,
    },
    wheels,
    motors,
    sensors,
    driverBoards: [
      {
        id: 'motor-driver',
        interfaceKind: 'pwm_direction',
        channels: [],
      },
    ],
    meta: {
      source: 'LiquidCAD Assembly',
      generatedAt: new Date().toISOString(),
      cadWorkspaceFile: assembly.groundedInstanceId ? 'main.assembly.js' : '',
    },
  };

  // 6. Generate Standard ROS URDF
  const urdfLines: string[] = [
    `<?xml version="1.0"?>`,
    `<robot name="${robotDef.id}">`,
    `  <!-- Base Link / Chassis -->`,
    `  <link name="base_link">`,
    `    <visual>`,
    `      <geometry>`,
    `        <box size="${chassisDims.x} ${chassisDims.y} ${chassisDims.z}"/>`,
    `      </geometry>`,
    `      <material name="chassis_mat">`,
    `        <color rgba="0.2 0.3 0.4 1.0"/>`,
    `      </material>`,
    `    </visual>`,
    `    <collision>`,
    `      <geometry>`,
    `        <box size="${chassisDims.x} ${chassisDims.y} ${chassisDims.z}"/>`,
    `      </geometry>`,
    `    </collision>`,
    `  </link>`,
    ``,
  ];

  for (const inst of instances) {
    if (inst.instanceId === chassisId) continue;
    const conf = userConfigs.get(inst.instanceId) || inferDefaultConfig(inst, false, instances, mates);
    const m = transforms.get(inst.instanceId);
    if (!m) continue;

    const linkName = conf.frameId || `${inst.name}_link`;
    const jointName = conf.jointName || `${inst.name}_joint`;
    const jointType = conf.role === 'wheel' ? 'continuous' : conf.role === 'servo' ? 'revolute' : conf.role === 'linear_actuator' ? 'prismatic' : 'fixed';

    urdfLines.push(`  <!-- Link: ${linkName} (${conf.role}) -->`);
    urdfLines.push(`  <link name="${linkName}"/>`);
    urdfLines.push(`  <joint name="${jointName}" type="${jointType}">`);
    urdfLines.push(`    <parent link="base_link"/>`);
    urdfLines.push(`    <child link="${linkName}"/>`);
    urdfLines.push(`    <origin xyz="${m.translationM.x} ${m.translationM.y} ${m.translationM.z}" rpy="${m.rotationRad.x} ${m.rotationRad.y} ${m.rotationRad.z}"/>`);

    if (jointType === 'revolute' || jointType === 'continuous') {
      urdfLines.push(`    <axis xyz="0 0 1"/>`);
      if (jointType === 'revolute' && conf.limitsDeg) {
        const lowerRad = num((conf.limitsDeg[0] * Math.PI) / 180);
        const upperRad = num((conf.limitsDeg[1] * Math.PI) / 180);
        urdfLines.push(`    <limit lower="${lowerRad}" upper="${upperRad}" effort="10.0" velocity="3.14"/>`);
      }
    } else if (jointType === 'prismatic') {
      urdfLines.push(`    <axis xyz="0 0 1"/>`);
      if (conf.limitsDeg) {
        const lowerM = num(conf.limitsDeg[0] / 1000);
        const upperM = num(conf.limitsDeg[1] / 1000);
        urdfLines.push(`    <limit lower="${lowerM}" upper="${upperM}" effort="20.0" velocity="0.5"/>`);
      }
    }

    urdfLines.push(`  </joint>`);
    urdfLines.push(``);
  }

  urdfLines.push(`</robot>`);

  return {
    robotDefinition: robotDef,
    urdf: urdfLines.join('\n'),
    transforms,
  };
}
