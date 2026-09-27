import fs from 'fs';
import path from 'path';
import { Router } from 'express';

export function createRoboticsRouter(workspacePath: string): Router {
  const router = Router();

  router.post('/robotics/export', async (req, res) => {
    try {
      const { robotDefinition, urdf, targetDir, activeFile } = req.body;
      if (!robotDefinition) {
        res.status(400).json({ success: false, error: 'Missing robotDefinition in request body.' });
        return;
      }

      // Determine target directories to write to:
      // If workspace is e.g. /Documents/Flow/Project/MyRobot/cad, then the project dir is /Documents/Flow/Project/MyRobot
      const candidateDirs: string[] = [];
      if (targetDir) {
        candidateDirs.push(targetDir);
      }
      if (workspacePath) {
        candidateDirs.push(workspacePath);
        const norm = workspacePath.replace(/\\/g, '/');
        if (norm.endsWith('/cad')) {
          candidateDirs.push(path.dirname(workspacePath));
        }
      }
      if (activeFile) {
        const fileDir = path.dirname(activeFile);
        candidateDirs.push(fileDir);
        const norm = fileDir.replace(/\\/g, '/');
        if (norm.endsWith('/cad')) {
          candidateDirs.push(path.dirname(fileDir));
        }
      }

      const uniqueDirs = Array.from(new Set(candidateDirs.filter(Boolean)));
      const writtenFiles: string[] = [];

      for (const dir of uniqueDirs) {
        try {
          if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
          }

          const jsonPath = path.join(dir, 'robot-definition.json');
          await fs.promises.writeFile(jsonPath, JSON.stringify(robotDefinition, null, 2), 'utf8');
          writtenFiles.push(jsonPath);

          if (urdf) {
            const urdfPath = path.join(dir, 'robot.urdf');
            await fs.promises.writeFile(urdfPath, urdf, 'utf8');
            writtenFiles.push(urdfPath);
          }
        } catch (err: any) {
          console.warn(`[RoboticsRouter] Failed to write robot definition to ${dir}:`, err.message);
        }
      }

      if (writtenFiles.length === 0) {
        res.status(500).json({ success: false, error: 'Could not write robot definition to any candidate directory.' });
        return;
      }

      res.json({
        success: true,
        writtenFiles,
        message: `Exported robot definition to ${writtenFiles.length} file(s).`,
      });
    } catch (error: any) {
      console.error('[RoboticsRouter] Error exporting robot definition:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
