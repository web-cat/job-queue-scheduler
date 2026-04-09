import { BaseSeeder } from '@adonisjs/lucid/seeders'
import ImageConfig from '#models/image_config'
import Job from '#models/job'
import JobResult from '#models/job_result'
import SystemSetting from '#models/system_setting'
import { DateTime } from 'luxon'

export default class MainSeeder extends BaseSeeder {
  async run() {
    // -------------------------------------------------------------------------
    // system_settings
    // -------------------------------------------------------------------------
    await SystemSetting.createMany([
      {
        key: 'scheduler_strategy',
        value: 'HRRN',
        description: 'Active scheduling algorithm (HRRN, FIFO, PRIORITY)',
      },
      {
        key: 'max_concurrent_jobs',
        value: '10',
        description: 'Maximum grading pods running simultaneously',
      },
      {
        key: 'default_timeout_seconds',
        value: '30',
        description: 'Fallback timeout if not set in image_configs',
      },
      {
        key: 'callback_retry_max',
        value: '3',
        description: 'Max webhook delivery attempts',
      },
      {
        key: 'callback_retry_delay_seconds',
        value: '5',
        description: 'Delay between webhook retries',
      },
    ])

    // -------------------------------------------------------------------------
    // image_configs
    // -------------------------------------------------------------------------
    const [javaGrader, pythonGrader, cppGrader] = await ImageConfig.createMany([
      {
        dockerImageTag: 'webcat/java-grader:example',
        displayName: 'Java Grader',
        timeoutSeconds: 30,
        memoryLimitMb: 512,
        cpuLimitMillicores: 1000,
        maxRetries: 3,
        defaultPriority: 5,
        defaultEstimatedRuntime: 15.0,
        isActive: true,
      },
      {
        dockerImageTag: 'webcat/python-grader:example',
        displayName: 'Python Grader',
        timeoutSeconds: 20,
        memoryLimitMb: 256,
        cpuLimitMillicores: 500,
        maxRetries: 3,
        defaultPriority: 5,
        defaultEstimatedRuntime: 10.0,
        isActive: true,
      },
      {
        dockerImageTag: 'webcat/cpp-grader:example',
        displayName: 'C++ Grader',
        timeoutSeconds: 45,
        memoryLimitMb: 1024,
        cpuLimitMillicores: 1500,
        maxRetries: 3,
        defaultPriority: 5,
        defaultEstimatedRuntime: 25.0,
        isActive: true,
      },
    ])

    const now = DateTime.now()

    // -------------------------------------------------------------------------
    // jobs — 4 pending, 2 processing, 3 completed, 1 failed
    // -------------------------------------------------------------------------

    // 4 pending (spread over last 2 hours)
    const pending1 = await Job.create({
      submissionId: 1001,
      dockerImageTag: javaGrader.dockerImageTag,
      status: 'pending',
      priority: 5,
      sourcePath: '/grading/uploads/1001',
      estimatedRuntime: javaGrader.defaultEstimatedRuntime,
      submittedAt: now.minus({ minutes: 120 }),
      imageConfigId: javaGrader.id,
      userId: 1,
      courseId: 10,
      assignmentName: 'Project 1',
    })

    const pending2 = await Job.create({
      submissionId: 1002,
      dockerImageTag: pythonGrader.dockerImageTag,
      status: 'pending',
      priority: 5,
      sourcePath: '/grading/uploads/1002',
      estimatedRuntime: pythonGrader.defaultEstimatedRuntime,
      submittedAt: now.minus({ minutes: 90 }),
      imageConfigId: pythonGrader.id,
      userId: 2,
      courseId: 10,
      assignmentName: 'Lab 3',
    })

    await Job.create({
      submissionId: 1003,
      dockerImageTag: cppGrader.dockerImageTag,
      status: 'pending',
      priority: 7,
      sourcePath: '/grading/uploads/1003',
      estimatedRuntime: cppGrader.defaultEstimatedRuntime,
      submittedAt: now.minus({ minutes: 45 }),
      imageConfigId: cppGrader.id,
      userId: 3,
      courseId: 11,
      assignmentName: 'Assignment 2',
    })

    await Job.create({
      submissionId: 1004,
      dockerImageTag: javaGrader.dockerImageTag,
      status: 'pending',
      priority: 3,
      sourcePath: '/grading/uploads/1004',
      estimatedRuntime: javaGrader.defaultEstimatedRuntime,
      submittedAt: now.minus({ minutes: 10 }),
      imageConfigId: javaGrader.id,
      userId: 4,
      courseId: 11,
      assignmentName: 'Project 1',
    })

    // 2 processing
    await Job.create({
      submissionId: 1005,
      dockerImageTag: pythonGrader.dockerImageTag,
      status: 'processing',
      priority: 5,
      sourcePath: '/grading/uploads/1005',
      estimatedRuntime: pythonGrader.defaultEstimatedRuntime,
      submittedAt: now.minus({ minutes: 15 }),
      startedAt: now.minus({ minutes: 2 }),
      workerPodName: 'grader-pod-a1b2c3',
      imageConfigId: pythonGrader.id,
      userId: 5,
      courseId: 10,
    })

    await Job.create({
      submissionId: 1006,
      dockerImageTag: cppGrader.dockerImageTag,
      status: 'processing',
      priority: 5,
      sourcePath: '/grading/uploads/1006',
      estimatedRuntime: cppGrader.defaultEstimatedRuntime,
      submittedAt: now.minus({ minutes: 20 }),
      startedAt: now.minus({ minutes: 5 }),
      workerPodName: 'grader-pod-d4e5f6',
      imageConfigId: cppGrader.id,
      userId: 6,
      courseId: 12,
    })

    // 3 completed (with job_results)
    const completed1 = await Job.create({
      submissionId: 1007,
      dockerImageTag: javaGrader.dockerImageTag,
      status: 'completed',
      priority: 5,
      sourcePath: '/grading/uploads/1007',
      estimatedRuntime: javaGrader.defaultEstimatedRuntime,
      submittedAt: now.minus({ hours: 3 }),
      startedAt: now.minus({ hours: 3, minutes: -2 }),
      completedAt: now.minus({ hours: 3, minutes: -15 }),
      actualRuntime: 13.4,
      hrrnScoreAtDequeue: 1.13,
      workerPodName: 'grader-pod-g7h8i9',
      resultDelivered: true,
      imageConfigId: javaGrader.id,
      userId: 1,
      courseId: 10,
      assignmentName: 'Project 1',
    })

    const completed2 = await Job.create({
      submissionId: 1008,
      dockerImageTag: pythonGrader.dockerImageTag,
      status: 'completed',
      priority: 5,
      sourcePath: '/grading/uploads/1008',
      estimatedRuntime: pythonGrader.defaultEstimatedRuntime,
      submittedAt: now.minus({ hours: 2 }),
      startedAt: now.minus({ hours: 2, minutes: -1 }),
      completedAt: now.minus({ hours: 2, minutes: -9 }),
      actualRuntime: 8.7,
      hrrnScoreAtDequeue: 1.09,
      workerPodName: 'grader-pod-j1k2l3',
      resultDelivered: false,
      imageConfigId: pythonGrader.id,
      userId: 2,
      courseId: 10,
    })

    const completed3 = await Job.create({
      submissionId: 1009,
      dockerImageTag: cppGrader.dockerImageTag,
      status: 'completed',
      priority: 8,
      sourcePath: '/grading/uploads/1009',
      estimatedRuntime: cppGrader.defaultEstimatedRuntime,
      submittedAt: now.minus({ hours: 1 }),
      startedAt: now.minus({ hours: 1, minutes: -3 }),
      completedAt: now.minus({ hours: 1, minutes: -25 }),
      actualRuntime: 22.1,
      hrrnScoreAtDequeue: 1.12,
      workerPodName: 'grader-pod-m4n5o6',
      resultDelivered: true,
      imageConfigId: cppGrader.id,
      userId: 7,
      courseId: 12,
      assignmentName: 'Assignment 2',
    })

    // Insert job_results for completed jobs
    await JobResult.createMany([
      {
        jobId: completed1.jobId,
        correctnessScore: 85.0,
        toolScore: 90.0,
        comments: 'Good work! Minor style issues.',
        commentFormat: 0,
        testOutput: 'All 17 tests passed.',
        exitCode: 0,
        runtimeMs: 13400,
        podName: completed1.workerPodName,
      },
      {
        jobId: completed2.jobId,
        correctnessScore: 72.5,
        toolScore: 80.0,
        comments: 'Several edge cases not handled.',
        commentFormat: 0,
        testOutput: '10/14 tests passed.',
        exitCode: 0,
        runtimeMs: 8700,
        podName: completed2.workerPodName,
      },
      {
        jobId: completed3.jobId,
        correctnessScore: 95.0,
        toolScore: 88.0,
        comments: 'Excellent submission.',
        commentFormat: 0,
        testOutput: 'All 22 tests passed.',
        exitCode: 0,
        runtimeMs: 22100,
        podName: completed3.workerPodName,
      },
    ])

    // 1 failed
    await Job.create({
      submissionId: 1010,
      dockerImageTag: javaGrader.dockerImageTag,
      status: 'failed',
      priority: 5,
      sourcePath: '/grading/uploads/1010',
      estimatedRuntime: javaGrader.defaultEstimatedRuntime,
      submittedAt: now.minus({ hours: 1, minutes: 30 }),
      startedAt: now.minus({ hours: 1, minutes: 28 }),
      completedAt: now.minus({ hours: 1, minutes: 15 }),
      retryCount: 3,
      errorMessage: 'Container exceeded memory limit and was killed (OOMKilled)',
      workerPodName: 'grader-pod-p7q8r9',
      imageConfigId: javaGrader.id,
      userId: 8,
      courseId: 11,
    })

    // suppress unused variable warnings for pending jobs not referenced after creation
    void pending1
    void pending2
  }
}
