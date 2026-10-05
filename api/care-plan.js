import {body,checkRequest,configuration,fail,finish,json,reserve,stats,visitor} from '../lib/core.js';
import {generateAssignments,validateAssignments,validateRoutine} from '../lib/planner.js';

export default async function handler(req,res) {
  let reservation;
  let usage;
  try {
    checkRequest(req);
    configuration(['GEMINI_API_KEY']);
    const input = body(req);
    const identity = visitor(req,res);
    const routine = validateRoutine(input);
    reservation = await reserve(identity,'plan',routine.safeInput);
    if (routine.refusal) {
      await finish(reservation,'refused',{message:routine.refusal});
      return json(res,422,{error:routine.refusal,code:'guardrail_refusal',remaining:reservation.remaining});
    }
    const generated = await generateAssignments(routine);
    usage = generated.usage;
    const tasks = validateAssignments(generated.result,routine.tasks);
    if (!tasks) {
      const message = 'AgeWell could not safely organize that routine. Use only existing routine tasks, with no medical advice requests.';
      await finish(reservation,'refused',{message},usage);
      return json(res,422,{error:message,code:'guardrail_refusal',remaining:reservation.remaining});
    }
    const output = {tasks,notice:'Coordination draft only. Review with your parent. No notifications are scheduled or sent. Keep all medication instructions from the prescriber unchanged.'};
    await finish(reservation,'completed',output,usage);
    let liveStats = null;
    try {liveStats = await stats();} catch { /* A successful saved plan remains usable if the count query fails. */ }
    json(res,200,{id:reservation.id,...output,remaining:reservation.remaining,stats:liveStats,usage:{inputTokens:usage.promptTokenCount || 0,outputTokens:usage.candidatesTokenCount || 0,model:usage.model}});
  } catch (error) {
    if (reservation) try {await finish(reservation,'failed',{message:error.code || 'service_unavailable'},usage);} catch { /* No success is reported if persistence failed. */ }
    fail(res,error);
  }
}
