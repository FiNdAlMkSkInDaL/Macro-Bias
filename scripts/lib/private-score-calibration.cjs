/** One predeclared learner. Receives historical reconstructions; never touches live scoring. */
function calibrateScore(rows, recipe, math) {
  const { average, fitRidge, predictRidge, clamp } = math;
  const evaluations = [];
  let fit = null, fittedMonth = '';
  for (const today of rows) {
    const lower = new Date(Date.parse(today.date) - recipe.trainingCalendarDays * 86400000).toISOString().slice(0, 10);
    const train = rows.filter(r => r.date >= lower && r.date < today.date && r.targetDate < today.date && Number.isFinite(r.outcome));
    if (train.length < recipe.minimumTrainingRows) continue;
    const base = { expectedReturn: average(train.map(r => r.outcome)), probabilityUp: average(train.map(r => Number(r.outcome > 0))) };
    if (today.date.slice(0, 7) !== fittedMonth) {
      const inputs = train.map(r => ({ features: [r.score / 100] }));
      const ret = fitRidge(inputs, train.map(r => r.outcome / r.volatility20), recipe.ridgePenaltyMeanLoss, recipe.featureClip);
      const probability = fitRidge(inputs, train.map(r => Number(r.outcome > 0)), recipe.ridgePenaltyMeanLoss, recipe.featureClip);
      ret.coefficients[0] = Math.max(0, ret.coefficients[0]);
      probability.coefficients[0] = Math.max(0, probability.coefficients[0]);
      fit = { ret, probability, sourceDate: today.date, maxTargetDate: train.at(-1).targetDate, trainingRows: train.length };
      fittedMonth = today.date.slice(0, 7);
    }
    if (fit.maxTargetDate >= fit.sourceDate || fit.sourceDate > today.date) throw Error('Calibration embargo failed');
    const x = [today.score / 100], weight = recipe.priorWeight;
    const candidate = {
      expectedReturn: weight * base.expectedReturn + (1 - weight) * predictRidge(fit.ret, x) * today.volatility20,
      probabilityUp: weight * base.probabilityUp + (1 - weight) * clamp(predictRidge(fit.probability, x), 0.01, 0.99),
    };
    evaluations.push({ date: today.date, targetDate: today.targetDate, outcome: today.outcome, base, candidate,
      fitSourceDate: fit.sourceDate, maxTrainingTargetDate: fit.maxTargetDate, trainingRows: fit.trainingRows });
  }
  return evaluations;
}
module.exports = { calibrateScore };
