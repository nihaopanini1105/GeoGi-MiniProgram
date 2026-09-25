(function(){
  const legacyRender=window.render;
  let selectedStageKey=sessionStorage.getItem('geogi_pipeline_stage')||'';
  let profileResearchRun=null;
  let profileResearchTimer=null;

  const PLATFORM_LABELS={doubao:'豆包',deepseek:'深度求索',tencent_yuanbao:'腾讯元宝',tongyi_qianwen:'通义千问',kimi:'月之暗面智能助手'};
  const STATE_LABELS={complete:'已完成',ready:'可处理',active:'进行中',blocked:'暂不可进行',awaiting_review:'待确认'};
  const TYPE_LABELS={
    customer_attachment:'客户资料',customer_intelligence_profile:'品牌企业画像',query_set:'检测问题集',query:'检测问题',
    prompt_instance:'平台测试问题',platform_test_plan:'五平台检测方案',observation_batch:'检测批次',platform_test_run:'平台检测',
    raw_answer:'AI 原始回答',dimension_result:'诊断维度',root_cause_finding:'根因',opportunity:'优化机会',
    recommended_action:'正式优化建议',solution_package:'客户专属优化方案',optimization_plan:'实施计划',action:'实施动作',
    action_acceptance_review:'实施验收',retest_comparison:'复测对比',outcome_assessment:'效果评估',
    diagnostic_report_release:'客户报告',monitoring_subscription:'持续监测'
  };

  function rows(d,type){return d?.records?.[type]||[]}
  function current(list){return (list||[]).filter(x=>!['superseded','archived','rejected'].includes(String(x.lifecycle_status||'')))}
  function latest(list){return [...current(list)].sort((a,b)=>String(b.generated_at||b.completed_at||b.updated_at||b.created_at||b.captured_at||'').localeCompare(String(a.generated_at||a.completed_at||a.updated_at||a.created_at||a.captured_at||'')))[0]||null}
  function projectId(d){return latest(rows(d,'project'))?.project_id||d?.projects?.[0]?.project_id||''}
  function clientId(d){return state.client||d?.client?.client_id||d?.workspace_client_id||''}
  function pct(v){return v===null||v===undefined?'—':(Number(v)*100).toFixed(1)+'%'}
  function val(v,f='—'){return v===null||v===undefined||v===''?f:String(v)}
  function formatResearchDate(v){
    if(!v)return '—';
    try{return new Date(v).toLocaleString('zh-CN',{hour12:false})}catch(_){return String(v)}
  }
  function formatElapsed(ms){
    const total=Math.max(0,Math.floor(Number(ms||0)/1000)),minutes=Math.floor(total/60),seconds=total%60;
    return String(minutes).padStart(2,'0')+':'+String(seconds).padStart(2,'0');
  }
  function statusChip(s){const cls=s==='complete'?'ok':s==='blocked'?'danger':'warn';return '<span class="status-chip '+cls+'">'+esc(STATE_LABELS[s]||s||'未知')+'</span>'}
  function kpi(label,value,note){return '<div class="biz-kpi"><span>'+esc(label)+'</span><strong>'+esc(val(value))+'</strong><small>'+esc(note||'')+'</small></div>'}
  function empty(msg){return '<div class="notice">'+esc(msg)+'</div>'}
  function stageByKey(d,key){return (d?.geo_pipeline?.stages||[]).find(x=>x.stage_key===key)||null}
  const STAGE_OPERATOR_DESCRIPTIONS={
    foundation:'系统根据客户资料执行全网公开检索并生成品牌企业画像；运营查阅结果，只修订不准确或仍然缺失的信息。',
    planning:'根据品牌企业画像确认检测问题、平台范围和执行安排。',
    detection:'在豆包、深度求索、腾讯元宝、通义千问和月之暗面智能助手执行检测并记录结果。',
    diagnosis:'查看品牌发现、推荐、引用、竞品差距、官网状态和主要问题。',
    optimization:'把诊断结果整理成可执行的优化方向、优先级和验证方式。',
    implementation:'按优化方案推进具体任务，记录执行情况并完成验收。',
    retest:'使用相同检测条件复测，比较优化前后的变化。',
    delivery_monitoring:'预览和交付客户报告，并安排后续持续监测与下一轮优化。'
  };
  function operatorStageDescription(stage){return STAGE_OPERATOR_DESCRIPTIONS[stage?.stage_key]||'查看本阶段任务、完成条件和下一步操作。'}
  function executionStatusLabel(v){return {
    not_started:'未开始',scheduled:'已安排',in_progress:'执行中',blocked:'暂缓',
    submitted_for_acceptance:'待验收',completed:'已完成',accepted:'已验收',accepted_with_limitations:'有条件验收',
    needs_revision:'需修改',pending_review:'待审核'
  }[String(v||'')]||String(v||'—')}

  function activeStage(d){
    const p=d?.geo_pipeline||{},stages=p.stages||[];
    if(state.clientTab&&stages.some(x=>x.stage_key===state.clientTab))return state.clientTab;
    if(selectedStageKey&&stages.some(x=>x.stage_key===selectedStageKey))return selectedStageKey;
    return p.current_stage_key||stages[0]?.stage_key||'foundation';
  }
  function setStage(key){selectedStageKey=key;sessionStorage.setItem('geogi_pipeline_stage',key)}

  function pipelineRail(d){
    const p=d?.geo_pipeline||{},stages=p.stages||[],active=activeStage(d);
    return '<div class="pipeline-shell"><div class="pipeline-summary"><div><div class="eyebrow">客户 GEO 服务进度</div><h3>从品牌资料到检测、优化与持续服务</h3><p>按阶段查看当前进度、待处理事项和下一步操作。</p></div><div class="pipeline-progress"><strong>'+esc(val(p.progress_percent,0))+'%</strong><span>'+esc(val(p.completed_stage_count,0))+' / '+esc(val(p.stage_count,8))+' 阶段完成</span></div></div><div class="pipeline-rail">'+stages.map((s,i)=>'<button class="pipeline-stage '+(s.stage_key===active?'active ':'')+(s.complete?'done ':'')+esc(s.state||'')+'" onclick="pipelineSelectStage(\''+esc(s.stage_key)+'\')"><span class="pipeline-index">'+(i+1)+'</span><span class="pipeline-stage-copy"><strong>'+esc(s.short_label||s.label)+'</strong><small>'+esc(STATE_LABELS[s.state]||s.state||'')+'</small></span></button>').join('')+'</div></div>';
  }

  function gatePanel(stage){
    const gates=stage?.quality_gates||[],blockers=stage?.blocked_reasons||[];
    return '<section class="biz-card pipeline-gates"><div class="biz-card-head"><div><h3>本阶段完成条件</h3><p>完成以下条件后即可进入下一阶段；缺失项会明确提示。</p></div>'+statusChip(stage?.state)+'</div><div class="biz-card-body"><div class="gate-list">'+gates.map(g=>'<div class="gate-row '+(g.passed?'passed':'pending')+'"><span>'+(g.passed?'✓':'○')+'</span><strong>'+esc(g.label||'完成条件')+'</strong></div>').join('')+'</div>'+(blockers.length?'<div class="notice danger-note" style="margin-top:12px">'+blockers.map(esc).join('；')+'</div>':'')+'</div></section>';
  }

  function pendingTasksPanel(stage){
    const tasks=stage?.pending_tasks||[];
    if(!tasks.length)return '';
    return '<section class="biz-card"><div class="biz-card-head"><div><h3>本阶段待确认事项</h3><p>需要人工确认的事项集中显示在这里。</p></div><span>'+tasks.length+' 项</span></div><div class="biz-card-body"><div class="record-list">'+tasks.map(t=>'<div class="record-item pipeline-task"><div><strong>'+esc(t.request_title||t.title||t.intervention_type||'人工确认')+'</strong><p>'+esc(t.reason||t.status||'待处理')+'</p></div><button class="primary-action compact" onclick="pipelineDecideTask(\''+esc(t.manual_intervention_task_id||t.object_id||'')+'\')">处理</button></div>').join('')+'</div></div></section>';
  }

  function sourceTypeLabel(v){return {
    official_website:'官方网站',official_social_account:'官方社交账号',company_registry:'企业登记信息',
    trademark_database:'商标信息',certification_database:'认证信息',government_or_regulator:'政府或监管来源',
    authoritative_media:'权威媒体',case_study:'公开案例',partner_or_supplier:'合作方资料',
    review_platform:'评价平台',other_public_source:'其他公开来源'
  }[String(v||'')]||'公开资料来源'}
  function authorityLabel(v){return {
    tier_1_official:'官方来源',tier_2_authoritative:'权威第三方',tier_3_independent:'独立第三方',unknown:'待确认'
  }[String(v||'')]||'待确认'}
  function cleanDisplayUrl(value){
    const text=String(value||'').trim();
    const match=text.match(/^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~%!&'()*+,;=:@\/?#-]*)?/);
    return match?match[0]:text;
  }
  function relationSignalLabel(v){return {
    official_domain:'官方网站',brand_name:'品牌名称',legal_name:'企业全称',
    topic_match:'研究主题',brand_name_body_only:'正文仅出现品牌名',
    legal_name_body_only:'正文仅出现企业全称',topic_match_body:'正文主题匹配'
  }[String(v||'')]||String(v||'已通过校验')}


  function factTypeLabel(v){return {
    identity:'品牌身份',organization:'企业主体属性',qualification:'资质与认证',geography:'服务市场',
    product:'产品',service:'服务',pricing:'价格与定价',audience:'目标客户',capacity:'服务能力',
    boundary:'服务边界',channel:'官方渠道',reputation:'口碑信息',case:'客户案例',relationship:'品牌关系'
  }[String(v||'')]||'品牌事实'}

  function researchEvidence(d){
    return d?.research_evidence||d?.customer_intelligence?.research_evidence||latest(rows(d,'customer_intelligence_profile'))?.research_evidence||{};
  }
  function researchStatusLabel(status){
    return {
      completed:'已完成',completed_with_failures:'已完成（部分来源未返回）',failed:'检索失败',stale_policy:'需要重新检索',not_run:'尚未检索'
    }[String(status||'')]||String(status||'尚未检索');
  }
  function profileRerunComparison(d,evidence){
    const history=[...(rows(d,'customer_intelligence_profile')||[])].sort((a,b)=>String(b.generated_at||b.updated_at||b.created_at||'').localeCompare(String(a.generated_at||a.updated_at||a.created_at||'')));
    const current=history[0]||null,previous=history[1]||null;
    const runAt=Date.parse(String(evidence?.completed_at||'')),profileAt=Date.parse(String(current?.generated_at||current?.updated_at||current?.created_at||''));
    if(Number.isFinite(runAt)&&Number.isFinite(profileAt)&&runAt>profileAt+1000){
      return {changed:false,labels:[],text:'本轮检索已经执行，但画像字段与当前版本一致，因此没有生成新的画像版本。'};
    }
    if(!current||!previous)return {changed:null,labels:[],text:'本轮检索已经执行，当前暂无上一版画像可供对比。'};
    const a=current.enterprise_profile||{},b=previous.enterprise_profile||{};
    const checks=[
      ['企业主体',a.identity_and_governance?.legal_name,b.identity_and_governance?.legal_name],
      ['细分类目',a.business_model_and_market?.industry_classification?.category,b.business_model_and_market?.industry_classification?.category],
      ['品牌类型',a.business_model_and_market?.brand_type,b.business_model_and_market?.brand_type],
      ['商业模式',a.business_model_and_market?.business_model,b.business_model_and_market?.business_model],
      ['服务方式',a.business_model_and_market?.service_delivery_model,b.business_model_and_market?.service_delivery_model],
      ['目标市场',a.business_model_and_market?.target_markets,b.business_model_and_market?.target_markets],
      ['产品与服务',a.products_and_services?.taxonomy,b.products_and_services?.taxonomy],
      ['公开定位',a.positioning_and_value?.public_positioning_summary,b.positioning_and_value?.public_positioning_summary],
      ['核心价值',a.positioning_and_value?.value_propositions,b.positioning_and_value?.value_propositions],
      ['差异化特点',a.positioning_and_value?.differentiators,b.positioning_and_value?.differentiators],
      ['目标客户',a.audiences_and_decision_model?.target_segments,b.audiences_and_decision_model?.target_segments],
      ['官方渠道',a.channels_and_presence?.official_channel_references,b.channels_and_presence?.official_channel_references]
    ];
    const norm=v=>JSON.stringify(v===undefined?null:v);
    const labels=checks.filter(([,x,y])=>norm(x)!==norm(y)).map(([label])=>label);
    return labels.length
      ?{changed:true,labels,text:'与上一版相比，本轮画像已更新：'+labels.slice(0,8).join('、')+(labels.length>8?' 等':'')+'。'}
      :{changed:false,labels:[],text:'本轮检索已经执行，但与上一版相比画像字段没有变化。'};
  }
  function researchEvidencePanel(d){
    const evidence=researchEvidence(d),tracks=evidence.tracks||[],analysis=(d?.brand_enterprise_profile||{}).research_analysis||{};
    const hasRun=Boolean(evidence.run_id),comparison=profileRerunComparison(d,evidence);
    const runId=String(evidence.run_id||''),runTail=runId?runId.slice(-8):'—';
    const groups=tracks.filter(track=>(track.candidates||[]).length).map(track=>{
      const sources=(track.candidates||[]).map(item=>{
        const title=item.title||item.url||'公开资料';
        const excerpt=String(item.text_excerpt||'').trim();
        const safeUrl=cleanDisplayUrl(item.url||'');
        return '<div class="profile-research-source"><div class="profile-research-source-main"><strong>'+esc(title)+'</strong><a href="'+esc(item.url||'#')+'" target="_blank" rel="noopener noreferrer">'+esc(safeUrl||'查看来源')+'</a>'+(excerpt?'<p>'+esc(excerpt)+'</p>':'')+'</div></div>';
      }).join('');
      return '<details class="profile-research-track"><summary><span>'+esc(track.label||track.track_key||'公开资料')+'</span><small>'+esc(String(track.candidate_count||0))+' 个相关页面</small></summary><div class="profile-research-source-list">'+sources+'</div></details>';
    }).join('');
    if(!hasRun){
      return '<section class="biz-card profile-research-panel"><div class="biz-card-head"><div><h3>全网品牌企业检索</h3><p>系统会根据客户提交的品牌、企业、行业、产品、市场和官方渠道信息检索公开网络，并把可用信息归入品牌画像。</p></div><span class="status-chip warn">尚未检索</span></div><div class="biz-card-body"><div class="notice">点击本阶段上方的“全网检索并生成品牌画像”。运营人员不需要逐条审核网页；检索完成后直接查阅画像和来源，只修订不准确或仍缺失的信息。</div></div></section>';
    }
    const firstPartyFetched=Number(evidence.first_party_fetched_candidate_count||0),firstPartyEligible=Number(evidence.first_party_eligible_candidate_count||0),firstPartyFailed=Number(evidence.first_party_fetch_failed_count||0);
    const firstPartyNote=firstPartyEligible>0
      ?'<div class="notice" style="margin-bottom:12px"><strong>第一方资料已进入画像分析：</strong> '+esc(String(firstPartyEligible))+' 个官网页面可用。</div>'
      :firstPartyFetched>0
      ?'<div class="notice warn" style="margin-bottom:12px"><strong>官网页面已读取，但没有足够可用正文进入画像分析。</strong> 系统不会把脚本占位页或空页面当作品牌事实。</div>'
      :firstPartyFailed>0
      ?'<div class="notice warn" style="margin-bottom:12px"><strong>官网第一方页面抓取失败。</strong> 本轮画像主要依据客户提交资料，公开网页结果仅作补充。</div>'
      :'';
    const runNotice='<div class="notice" style="margin-bottom:12px"><strong>本轮检索已执行。</strong> 完成时间：'+esc(formatResearchDate(evidence.completed_at))+' · 批次：'+esc(runTail)+'<br>'+esc(comparison.text)+'</div>';
    return '<section class="biz-card profile-research-panel"><div class="biz-card-head"><div><h3>全网品牌企业检索</h3><p>公开网络检索结果已按品牌画像维度整理，可直接查阅来源与正文摘要，不需要逐条审核。</p></div><span class="status-chip '+(evidence.status==='failed'||evidence.status==='stale_policy'?'warn':'ok')+'">'+esc(researchStatusLabel(evidence.status))+'</span></div><div class="biz-card-body">'+runNotice+firstPartyNote+'<div class="profile-research-metrics"><div><span>已读取页面</span><strong>'+esc(String(evidence.fetched_candidate_count||0))+'</strong></div><div><span>相关页面</span><strong>'+esc(String(evidence.eligible_candidate_count||0))+'</strong></div><div><span>第一方可用页面</span><strong>'+esc(String(firstPartyEligible))+'</strong></div><div><span>覆盖维度</span><strong>'+esc(String(evidence.covered_track_count||0))+'</strong></div><div><span>系统分析结果</span><strong>'+esc(String(analysis.auto_applied_field_count||0))+' 项</strong></div><div><span>最近检索</span><strong>'+esc(formatResearchDate(evidence.completed_at))+'</strong></div></div>'+(groups?'<div class="profile-research-grid">'+groups+'</div>':empty('本轮没有找到与当前品牌或研究主题明确相关的公开页面。画像仍会保留客户提交的信息，可直接修订。'))+'</div></section>';
  }

  function profileValues(value){
    if(value===undefined||value===null||value==='')return [];
    if(Array.isArray(value))return value.flatMap(profileValues).filter(Boolean);
    if(typeof value==='object'){
      const preferred=value.persona_name||value.journey_name||value.stage_name||value.stage_goal||value.name||value.category||value.title||value.label||value.role||value.domain||value.url||value.primary_industry||value.value;
      if(preferred)return [String(preferred)];
      return Object.values(value).flatMap(profileValues).filter(Boolean);
    }
    return [String(value)];
  }
  function uniqueProfileValues(values,limit=8){
    const out=[];for(const value of values.flatMap(profileValues)){const clean=String(value||'').trim();if(clean&&!out.includes(clean))out.push(clean);if(out.length>=limit)break}return out;
  }
  function profileTag(label,value){
    if(!value)return '';
    return '<span class="brand-profile-tag"><b>'+esc(label)+'</b><span>'+esc(value)+'</span></span>';
  }
  function profileTagList(values,emptyText='暂未识别'){
    const items=uniqueProfileValues([values],8);
    return items.length?'<div class="brand-profile-chip-list">'+items.map(v=>'<span class="brand-profile-chip">'+esc(v)+'</span>').join('')+'</div>':'<span class="brand-profile-empty">'+esc(emptyText)+'</span>';
  }
  function profileFieldMeta(path){
    return (window._clientData?.brand_profile_field_provenance||{})[path]||null;
  }
  function pricePositionLabel(v){return {
    free:'免费',budget:'低价',value:'高性价比',mid_market:'中端',premium:'高端',luxury:'奢侈 / 顶级',
    enterprise:'企业级',custom_quote:'定制报价',varies_by_offer:'按产品 / 服务变化',unknown:'待竞品价格对比'
  }[String(v||'')]||String(v||'')}
  function profileFieldSource(path){
    if(!path)return '';
    const meta=profileFieldMeta(path);
    if(meta)return '<span class="profile-field-source operator">人工修订</span>';
    const profile=(window._clientData||{}).brand_enterprise_profile||{};
    const sourcePath={
      'content_and_knowledge_assets.operator_assets':'content_and_knowledge_assets.research_assets',
      'reputation_and_trust.operator_trust_notes':'reputation_and_trust.research_summary'
    }[path]||path;
    const analysis=profile.research_analysis||{};
    const sources=analysis.field_sources?.[sourcePath]||[];
    const provenance=analysis.field_provenance?.[sourcePath]||{};
    const applied=(analysis.applied_field_paths||[]).includes(sourcePath);
    if(!applied)return '';
    const priority=String(provenance.source_priority||'');
    const label={
      first_party:'第一方资料',
      customer_input:'客户资料推导',
      system_inference:'系统推导',
      public_research:'公开资料分析'
    }[priority]||(sources.length?'系统分析':'系统推导');
    return '<span class="profile-field-source system">'+esc(label)+'</span>';
  }
  function profileResearchSummary(items){
    const excerpts=(items||[]).map(x=>String(x?.text_excerpt||'').trim()).filter(Boolean);
    if(!excerpts.length)return '';
    const summary=excerpts.slice(0,2).map(text=>text.length>220?text.slice(0,220)+'…':text).join(' ');
    return '<div class="profile-domain-research-summary"><span>公开资料摘要</span><p>'+esc(summary)+'</p></div>';
  }
  function profileResearchSources(items){
    const rows=(items||[]).filter(x=>x&&x.url).slice(0,5);
    if(!rows.length)return '';
    const body=rows.map(item=>{
      const title=item.title||item.url||'公开资料';
      const url=String(item.url||'');
      const safeLink=/^https?:\/\//i.test(url)?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(cleanDisplayUrl(url)||url)+'</a>':'<span>'+esc(cleanDisplayUrl(url)||url)+'</span>';
      const excerpt=String(item.text_excerpt||'').trim();
      return '<div class="profile-domain-source"><strong>'+esc(title)+'</strong>'+safeLink+(excerpt?'<p>'+esc(excerpt)+'</p>':'')+'</div>';
    }).join('');
    return '<details class="profile-domain-sources"><summary>系统检索依据 '+rows.length+' 个</summary><div class="profile-domain-source-list">'+body+'</div></details>';
  }
  function profileDomainCard(index,title,state,rows,tags,note,researchSources){
    const statusText={complete:'信息充足',partial:'已有信息',missing:'暂未识别',pending:'检测后生成'}[state]||'暂未识别';
    const statusClass=state==='complete'?'ok':'warn';
    const body=(rows||[]).filter(x=>x&&x[1]!==undefined).map(([label,value,path,fieldType])=>{
      const vals=uniqueProfileValues([value],6);
      const editable=!!path;
      const source=editable?profileFieldSource(path):'';
      return '<div class="brand-profile-row'+(editable?' editable':'')+'"><span>'+esc(label)+'</span><div class="brand-profile-row-main">'+(vals.length?'<div class="brand-profile-row-values">'+vals.map(v=>'<strong>'+esc(fieldType==='price'?pricePositionLabel(v):v)+'</strong>').join('')+'</div>':'<em>暂未识别</em>')+source+'</div>'+(editable?'<button class="profile-field-edit" type="button" onclick="pipelineEditBrandProfileField(\''+esc(path)+'\',\''+esc(label)+'\',\''+esc(fieldType||'text')+'\')">编辑</button>':'<span class="profile-field-readonly">系统生成</span>')+'</div>';
    }).join('');
    return '<article class="brand-profile-domain '+esc(state)+'"><div class="brand-profile-domain-head"><span class="brand-profile-index">'+esc(index)+'</span><div><h4>'+esc(title)+'</h4>'+(note?'<p>'+esc(note)+'</p>':'')+'</div><span class="status-chip '+statusClass+'">'+statusText+'</span></div>'+(tags?'<div class="brand-profile-domain-tags">'+profileTagList(tags)+'</div>':'')+'<div class="brand-profile-domain-body">'+body+'</div>'+profileResearchSummary(researchSources)+profileResearchSources(researchSources)+'</article>';
  }

  function foundationDetail(d,stage){
    const profile=d?.brand_enterprise_profile||{},ready=d?.customer_intelligence_readiness||{},
      identity=profile.identity_and_governance||{},business=profile.business_model_and_market||{},
      offer=profile.products_and_services||{},position=profile.positioning_and_value||{},
      aud=profile.audiences_and_decision_model||{},journey=profile.customer_journey||{},
      channels=profile.channels_and_presence||{},assets=profile.content_and_knowledge_assets||{},
      trust=profile.reputation_and_trust||{},competition=profile.competition_and_market||{},
      visibility=profile.geo_and_ai_visibility||{},complete=profile.information_completeness||{},
      research=researchEvidence(d);
    const blockers=ready.critical_blockers||[],warnings=ready.warnings||[],missing=complete.missing_sections||[],quality=complete.quality_issues||[];
    const dims=Object.fromEntries((ready.dimensions||[]).map(x=>[x.key,x]));
    const state=(key,hasData=false,pending=false)=>pending?'pending':(dims[key]?.ready?'complete':hasData?'partial':'missing');
    const industry=business.industry_classification||{};
    const primaryProducts=uniqueProfileValues([offer.primary_products],5);
    const products=uniqueProfileValues([offer.taxonomy,offer.customer_submitted_offerings],8);
    const values=uniqueProfileValues([position.value_propositions,position.customer_submitted_advantages],8);
    const differentiators=uniqueProfileValues([position.differentiators,position.customer_submitted_advantages],8);
    const segments=uniqueProfileValues([aud.target_segments,aud.customer_submitted_audiences],8);
    const criteria=uniqueProfileValues([aud.customer_decision_criteria],8);
    const scenarios=uniqueProfileValues([journey.key_scenarios],8);
    const markets=uniqueProfileValues([business.target_markets,business.market,identity.market],6);
    const publicPricing=uniqueProfileValues([business.public_pricing],8);
    const channelValues=uniqueProfileValues([channels.operator_official_channels,channels.owned_sources,channels.official_channel_references,channels.customer_submitted_official_channel,identity.website],8);
    const contentAssets=uniqueProfileValues([assets.operator_assets,assets.customer_submitted_assets,assets.research_assets,assets.assessments],8);
    const competitors=uniqueProfileValues([competition.operator_competitors,competition.items,competition.customer_submitted_competitors],8);
    const serviceBoundaries=uniqueProfileValues([offer.service_boundaries],8);
    const proofPoints=uniqueProfileValues([position.proof_points],6);
    const trustValues=uniqueProfileValues([trust.operator_trust_notes,trust.research_summary],8);
    const objectives=uniqueProfileValues([business.project_objectives],6);
    const publicResearchCount=Number(research.eligible_candidate_count||0);
    const topTags=[
      profileTag('行业',industry.primary_industry||business.industry),
      profileTag('细分类目',industry.category),
      profileTag('品牌类型',business.brand_type),
      profileTag('商业模式',business.business_model),
      profileTag('交付方式',business.service_delivery_model),
      ...(publicPricing.slice(0,1).map(v=>profileTag('公开价格',v))),
      profileTag('价格定位',pricePositionLabel(business.price_positioning)),
      ...markets.slice(0,2).map(v=>profileTag('市场',v)),
      ...primaryProducts.slice(0,3).map(v=>profileTag('主要产品',v)),
      ...products.slice(0,2).map(v=>profileTag('产品/服务',v)),
      ...segments.slice(0,2).map(v=>profileTag('目标客户',v))
    ].filter(Boolean);
    const featureTags=uniqueProfileValues([values,differentiators],12);
    const profileName=identity.brand_name||'当前客户';
    const statusNote=ready.status==='READY_FOR_DIAGNOSIS'
      ?'<div class="notice profile-ready-note" style="margin-top:16px"><strong>品牌企业画像已具备进入下一步的关键信息。</strong> 可以继续生成检测策略与问题。</div>'
      :'<div class="notice warn" style="margin-top:16px"><strong>画像仍有关键缺失项。</strong><br>'+esc((blockers.length?blockers:missing).join('；')||'请先执行全网检索，再修订仍然缺失或不准确的信息。')+'</div>';
    const qualityItems=[...warnings,...quality].filter((v,i,a)=>v&&a.indexOf(v)===i);
    const qualityNote=qualityItems.length?'<div class="notice" style="margin-top:10px"><strong>仍可完善：</strong> '+esc(qualityItems.join('；'))+'</div>':'';
    const domains=[
      profileDomainCard('01','品牌与企业身份',state('identity',!!(identity.brand_name||identity.legal_name)),[
        ['品牌名称',identity.brand_name,'identity_and_governance.brand_name','text'],
        ['企业主体',identity.legal_name,'identity_and_governance.legal_name','text'],
        ['官方网站',identity.website,'identity_and_governance.website','url'],
        ['其他名称',identity.alternate_names,'identity_and_governance.alternate_names','list']
      ],[identity.identity_status==='researched'?'系统检索':identity.identity_status==='verified'?'已有确认资料':'客户提交'],null,identity.research_sources),
      profileDomainCard('02','商业模式与市场',state('business_market',!!(business.business_model||business.industry||markets.length)),[
        ['所属行业',industry.primary_industry||business.industry,'business_model_and_market.industry_classification.primary_industry','text'],
        ['细分类目',industry.category,'business_model_and_market.industry_classification.category','text'],
        ['品牌类型',business.brand_type,'business_model_and_market.brand_type','text'],
        ['商业模式',business.business_model,'business_model_and_market.business_model','text'],
        ['服务方式',business.service_delivery_model,'business_model_and_market.service_delivery_model','text'],
        ['目标市场',markets,'business_model_and_market.target_markets','list'],
        ['公开价格 / 收费方式',publicPricing,'business_model_and_market.public_pricing','list'],
        ['价格定位（相对市场）',business.price_positioning,'business_model_and_market.price_positioning','price'],
        ['本次业务目标',objectives,'business_model_and_market.project_objectives','list']
      ],[industry.category,business.brand_type,business.business_model,pricePositionLabel(business.price_positioning)],null,business.research_sources),
      profileDomainCard('03','产品与服务体系',state('products_services',products.length>0||primaryProducts.length>0),[
        ['主要产品',primaryProducts,'products_and_services.primary_products','list'],
        ['产品 / 服务体系',products,'products_and_services.taxonomy','list'],
        ['服务边界',serviceBoundaries,'products_and_services.service_boundaries','list']
      ],primaryProducts.length?primaryProducts:products,'系统结合客户资料与公开页面整理产品和服务范围',offer.research_sources),
      profileDomainCard('04','品牌定位与差异化',state('positioning_value',values.length>0||differentiators.length>0),[
        ['公开定位',position.public_positioning_summary,'positioning_and_value.public_positioning_summary','text'],
        ['核心价值',values,'positioning_and_value.value_propositions','list'],
        ['差异化特点',differentiators,'positioning_and_value.differentiators','list'],
        ['可验证证明点',proofPoints,'positioning_and_value.proof_points','list']
      ],differentiators,'用于后续判断 AI 是否正确理解品牌价值与差异',position.research_sources),
      profileDomainCard('05','目标客户与购买决策',state('audience_decision',segments.length>0||criteria.length>0),[
        ['目标客户',segments,'audiences_and_decision_model.target_segments','list'],
        ['购买 / 选择标准',criteria,'audiences_and_decision_model.customer_decision_criteria','list'],
        ['目标客户画像',profileValues(aud.personas).map(x=>x).slice(0,6),null,null]
      ],segments,'系统结合客户描述与行业公开信息整理目标客户',aud.research_sources),
      profileDomainCard('06','客户决策与转化路径',state('decision_model',scenarios.length>0||profileValues(journey.journeys).length>0),[
        ['关键决策场景',scenarios,'customer_journey.key_scenarios','list'],
        ['客户决策旅程',uniqueProfileValues([journey.operator_journey_notes,journey.journeys],8),'customer_journey.operator_journey_notes','list']
      ],scenarios,'用于后续生成贴近真实客户需求的检测问题',journey.research_sources),
      profileDomainCard('07','官方渠道与数字阵地',state('official_presence',channelValues.length>0),[
        ['官网 / 官方渠道',channelValues,'channels_and_presence.operator_official_channels','list'],
        ['系统识别官方来源',trust.official_source_count?String(trust.official_source_count)+' 个':'',null,null]
      ],channelValues,'展示客户提交与系统检索到的品牌官方入口',channels.research_sources),
      profileDomainCard('08','内容与知识资产',contentAssets.length>0?'partial':(publicResearchCount>0?'partial':'missing'),[
        ['内容 / 知识资产',contentAssets,'content_and_knowledge_assets.operator_assets','list'],
        ['系统检索内容来源',(assets.research_sources||[]).length?String((assets.research_sources||[]).length)+' 个':'',null,null]
      ],contentAssets,'用于判断品牌公开内容是否足以支撑 AI 理解与引用',assets.research_sources),
      profileDomainCard('09','竞争环境与替代方案',state('competition',competitors.length>0),[
        ['主要竞品 / 替代方案',competitors,'competition_and_market.operator_competitors','list'],
        ['系统识别竞争对象',competition.identified_count?String(competition.identified_count)+' 个':'',null,null]
      ],competitors,'结合客户提交、公开检索和后续 AI 检测持续完善',competition.research_sources),
      profileDomainCard('10','可信度与外部认知',state('verified_facts',trustValues.length>0||publicResearchCount>0||Number(trust.authoritative_source_count||0)>0),[
        ['外部认知 / 可信信息',trustValues,'reputation_and_trust.operator_trust_notes','list'],
        ['公开检索相关页面',publicResearchCount?String(publicResearchCount)+' 个':'',null,null],
        ['权威资料来源',trust.authoritative_source_count?String(trust.authoritative_source_count)+' 个':'',null,null],
        ['冲突 / 过期信息',trust.conflicted_fact_count?String(trust.conflicted_fact_count)+' 条':'',null,null]
      ],[publicResearchCount?'已有公开检索依据':''],null,trust.research_sources),
      profileDomainCard('11','AI 平台认知现状',Number(visibility.eligible_observation_count||0)>0?'partial':'pending',[
        ['可用于诊断的回答',visibility.eligible_observation_count?String(visibility.eligible_observation_count)+' 条':'',null,null],
        ['品牌提及率',visibility.mention_rate===null||visibility.mention_rate===undefined?'':pct(visibility.mention_rate),null,null],
        ['品牌引用率',visibility.citation_rate===null||visibility.citation_rate===undefined?'':pct(visibility.citation_rate),null,null],
        ['AI 决策声量占比',visibility.share_of_voice===null||visibility.share_of_voice===undefined?'':pct(visibility.share_of_voice),null,null]
      ],[],'该部分来自实际 AI 平台检测结果，由系统生成，不支持手动修改')
    ].join('');
    const analysis=profile.research_analysis||{};
    const analysisHeadline=analysis.status==='synthesized_from_customer_input'
      ?'已根据客户提交资料推导出 '+String(analysis.auto_applied_field_count||0)+' 项基础画像字段'
      :'已结合客户资料与公开检索分析出 '+String(analysis.auto_applied_field_count||0)+' 项画像候选';
    const analysisNote=analysis.auto_applied_field_count?'<div class="profile-analysis-note"><span>系统分析</span><strong>'+esc(analysisHeadline)+'</strong><p>'+esc(analysis.summary||'可继续查阅来源并直接修订。')+'</p></div>':'';
    const profileCard='<section class="biz-card brand-profile-overview"><div class="biz-card-head brand-profile-head"><div><span class="brand-profile-kicker">品牌企业画像</span><h3>'+esc(profileName)+'</h3><p>'+esc(identity.legal_name||'企业主体暂未识别')+(identity.website?' · '+esc(identity.website):'')+'</p></div><div class="brand-profile-readiness"><strong>'+esc(ready.score===undefined?'—':ready.score+'%')+'</strong><span>下一步准备度</span><small>'+esc(String(complete.complete_section_count||0))+' / '+esc(String(complete.section_count||0))+' 项已有信息</small></div></div><div class="biz-card-body">'+analysisNote+'<div class="brand-profile-summary"><div><h4>画像标签</h4><p>基于客户提交资料、系统全网公开检索和人工修订生成。</p></div><div class="brand-profile-tags">'+(topTags.join('')||'<span class="brand-profile-empty">暂未形成画像标签</span>')+'</div></div><div class="brand-profile-summary feature-summary"><div><h4>品牌特点</h4><p>系统先整理已有信息，运营只需修正不准确或仍然缺失的内容。</p></div>'+profileTagList(featureTags,'暂未识别明确的品牌特点')+'</div><div class="brand-profile-section-title"><div><h4>画像信息</h4><p>按 11 个业务维度整理；系统优先使用客户资料与第一方证据补全，缺少直接证据时使用可追溯的系统推导，不把工作推断冒充已验证事实。</p></div><span>11 个画像维度</span></div><div class="brand-profile-domain-grid">'+domains+'</div>'+statusNote+qualityNote+'</div></section>';
    return '<div class="pipeline-detail-grid">'+researchEvidencePanel(d)+profileCard+'</div>';
  }

  function planningQueryTypeLabel(value){
    return {
      need_discovery:'需求发现',category_positioning:'品类认知',brand_recommendation:'品牌推荐',
      solution_selection:'方案比较',identity_disambiguation:'品牌身份',product_or_service:'产品 / 服务',
      scenario_recommendation:'场景推荐',brand_verification:'品牌验证',qualification:'风险核验',
      risk_or_boundary:'决策边界',brand_comparison:'品牌比较',audience_fit:'人群匹配',
      reputation:'口碑',temporal_freshness:'时效性'
    }[String(value||'')]||String(value||'其他');
  }
  function planningJourneyLabel(value){
    return {
      need_trigger:'需求触发',awareness:'认知',exploration:'发现',comparison:'比较',
      verification:'验证',decision:'决策',purchase:'购买 / 咨询',experience:'使用体验',
      advocacy_or_repurchase:'复购 / 推荐'
    }[String(value||'')]||String(value||'—');
  }
  function planningAwarenessLabel(value){
    return {
      unaware:'未指定品牌',category_aware:'已知品类',brand_aware:'已知品牌',
      comparing_known_brands:'已知多个品牌',existing_customer:'现有客户'
    }[String(value||'')]||String(value||'—');
  }
  function planningMentionLabel(value){
    return {
      no_brand_allowed:'不提示目标品牌',target_brand_allowed:'允许出现目标品牌',
      comparison_brands_allowed:'允许竞品比较',historical_or_alias_allowed:'允许历史名 / 别名'
    }[String(value||'')]||String(value||'—');
  }
  function planningProfileBasisSummary(d,queries){
    const profile=d?.brand_enterprise_profile||{},identity=profile.identity_and_governance||{},
      business=profile.business_model_and_market||{},offers=profile.products_and_services||{},
      audience=profile.audiences_and_decision_model||{},journey=profile.customer_journey||{},
      competition=profile.competition_and_market||{};
    const first=queries[0]||{},constraint=first.constraint_bundle||{};
    const products=uniqueProfileValues([offers.primary_products,offers.taxonomy],4);
    const segments=uniqueProfileValues([audience.target_segments,audience.customer_submitted_audiences],4);
    const scenarios=uniqueProfileValues([journey.key_scenarios],4);
    const competitors=uniqueProfileValues([competition.operator_competitors,competition.items,competition.customer_submitted_competitors],4);
    return '<section class="planning-profile-basis"><div class="planning-profile-basis-head"><div><span class="eyebrow">生成依据</span><h4>当前品牌企业画像</h4><p>检测问题只使用当前画像中的品牌、产品/服务、目标客户、决策场景、比较对象和可信信息生成。</p></div><span class="status-chip ok">画像驱动</span></div><div class="planning-profile-basis-grid">'
      +'<div><span>品牌</span><strong>'+esc(identity.brand_name||'—')+'</strong></div>'
      +'<div><span>行业 / 品类</span><strong>'+esc((business.industry_classification||{}).primary_industry||business.industry||'—')+'</strong></div>'
      +'<div><span>主要产品 / 服务</span><strong>'+esc(products.join('、')||'—')+'</strong></div>'
      +'<div><span>目标客户</span><strong>'+esc(segments.join('、')||'—')+'</strong></div>'
      +'<div><span>关键场景</span><strong>'+esc(scenarios.join('、')||'—')+'</strong></div>'
      +'<div><span>主要竞品 / 替代方案</span><strong>'+esc(competitors.join('、')||'—')+'</strong></div>'
      +'</div><div class="planning-profile-source-line"><span>画像版本：'+esc(constraint.customer_intelligence_profile_version||'—')+'</span><span>画像准备度：'+esc(constraint.customer_intelligence_score===undefined?'—':constraint.customer_intelligence_score+'%')+'</span><span>生成方式：品牌画像驱动</span></div></section>';
  }
  function planningRevisionMeta(set){return (set?.metadata||{}).detection_plan_revision||{}}
  function planningHistoryMeta(set){return (set?.metadata||{}).detection_plan_history||{}}
  function planningOrderedQueries(d,set){
    const all=current(rows(d,'query')),map={};all.forEach(q=>map[String(q.query_id||q.object_id||'')]=q);
    const refs=(set?.query_references||[]).map(String),ordered=refs.map(id=>map[id]).filter(Boolean);
    if(ordered.length)return ordered;
    return all.sort((a,b)=>String(a.deduplication_group||a.query_id||'').localeCompare(String(b.deduplication_group||b.query_id||'')));
  }
  function planningQuestionCard(query,index,personaById){
    const basis=(query.constraint_bundle||{}).profile_basis||[];
    const persona=personaById[String(query.persona_graph_id||'')]||'画像目标人群';
    return '<article class="planning-question-card"><div class="planning-question-number">'+String(index+1).padStart(2,'0')+'</div><div class="planning-question-main"><div class="planning-question-meta"><span>'+esc(planningQueryTypeLabel(query.query_type))+'</span><span>'+esc(planningJourneyLabel(query.journey_stage))+'</span><span>'+esc(persona)+'</span></div><h4>'+esc(query.query_text||'检测问题')+'</h4><div class="planning-question-intent"><span>检测目的</span><p>'+esc(query.query_intent||'—')+'</p></div><div class="planning-question-foot"><div><span>品牌提示</span><strong>'+esc(planningMentionLabel(query.brand_mention_policy))+'</strong></div><div><span>用户认知</span><strong>'+esc(planningAwarenessLabel(query.brand_awareness_level))+'</strong></div><div class="planning-question-basis"><span>来自画像</span><strong>'+esc(basis.join('、')||'品牌企业画像')+'</strong></div></div></div></article>';
  }
  function planningVersionHistory(d,set){
    const history=[...(rows(d,'query_set')||[])].filter(x=>(x.query_references||[]).length).sort((a,b)=>{
      const am=planningRevisionMeta(a),ah=planningHistoryMeta(a),bm=planningRevisionMeta(b),bh=planningHistoryMeta(b);
      return String(bm.revised_at||bh.archived_at||b.updated_at||b.created_at||'').localeCompare(String(am.revised_at||ah.archived_at||a.updated_at||a.created_at||''));
    });
    if(history.length<=1)return '';
    const activeId=String(set?.query_set_id||set?.object_id||'');
    const items=history.slice(0,8).map(x=>{
      const revision=planningRevisionMeta(x),archived=planningHistoryMeta(x),id=String(x.query_set_id||x.object_id||''),isCurrent=id===activeId;
      const status=isCurrent?(String(x.review_status||'')==='approved'?'当前已确认':'当前待确认'):'历史版本';
      const origin=archived.archive_reason
        ?(String(archived.archive_reason).startsWith('manual_revision:')?'人工修订前版本':'重新生成前版本')
        :(revision.revision_origin==='manual'?'人工修订':'系统生成');
      const reason=revision.revision_reason||String(archived.archive_reason||'').replace(/^manual_revision:/,'')||'版本留痕';
      return '<div class="record-item"><div><strong>V'+esc(x.semantic_version||String(revision.revision_number||'—'))+' · '+esc(origin)+'</strong><p>'+esc(reason)+' · '+esc(formatResearchDate(revision.revised_at||archived.archived_at||x.updated_at||x.created_at))+'</p></div><span class="status-chip '+(isCurrent?'ok':'')+'">'+esc(status)+'</span></div>';
    }).join('');
    return '<div style="margin-top:16px"><div class="planning-question-section-head"><div><h4>版本记录</h4><p>重新生成和人工修订都会保留上一版完整问题集，不覆盖历史检测口径。</p></div><span>'+esc(String(history.length))+' 个版本</span></div><div class="record-list">'+items+'</div></div>';
  }
  function planningDetail(d,stage){
    const sets=current(rows(d,'query_set'));
    const pendingSet=latest(sets.filter(x=>['pending_review','changes_requested'].includes(String(x.review_status||''))));
    const approvedSet=latest(sets.filter(x=>String(x.review_status||'')==='approved'));
    const set=pendingSet||approvedSet||latest(sets);
    const queries=planningOrderedQueries(d,set);
    const prompts=current(rows(d,'prompt_instance')),signals=current(rows(d,'query_signal')),plan=latest(rows(d,'platform_test_plan'));
    const personas=current(rows(d,'persona_graph')),personaById={};personas.forEach(p=>personaById[String(p.persona_graph_id||p.object_id||'')]=p.persona_name||p.name||'画像目标人群');
    const byType={},journeyStages=new Set(),basisDimensions=new Set();
    queries.forEach(q=>{
      const k=planningQueryTypeLabel(q.query_type);byType[k]=(byType[k]||0)+1;
      if(q.journey_stage)journeyStages.add(planningJourneyLabel(q.journey_stage));
      ((q.constraint_bundle||{}).profile_basis||[]).forEach(x=>basisDimensions.add(String(x)));
    });
    const normalized=queries.map(q=>String(q.query_text||'').trim().toLowerCase()).filter(Boolean);
    const duplicateCount=normalized.length-new Set(normalized).size;
    const profileGrounded=queries.filter(q=>String((q.constraint_bundle||{}).generation_basis||'')==='brand_enterprise_intelligence_profile').length;
    const qualityPassed=queries.length===12&&duplicateCount===0&&profileGrounded===queries.length;
    const revision=planningRevisionMeta(set),revisionLabel=set?(set.semantic_version||('1.0.'+Math.max(0,Number(revision.revision_number||1)-1))):'—';
    const targetPlatforms=(plan?.platform_references||Object.keys(PLATFORM_LABELS)).map(p=>PLATFORM_LABELS[p]||p);
    const status=String(set?.review_status||''),isPending=['pending_review','changes_requested'].includes(status),isApproved=status==='approved';
    const controls=!set
      ?'<button class="primary-action" onclick="pipelineRegenerateDetectionQuestions()">根据品牌画像生成检测方案</button>'
      :isPending
      ?'<button class="secondary-action" onclick="pipelineRegenerateDetectionQuestions()">重新生成</button><button class="secondary-action" onclick="pipelineReviseDetectionPlan()">修订方案</button><button class="primary-action" onclick="pipelineApproveDetectionPlan()">确认方案并进入检测</button>'
      :'';
    const planStatusChip=isApproved?'<span class="status-chip ok">已确认并冻结</span>':isPending?'<span class="status-chip warn">待确认</span>':'<span class="status-chip">尚未生成</span>';
    const questionList=queries.length?'<div class="planning-question-list">'+queries.map((q,i)=>planningQuestionCard(q,i,personaById)).join('')+'</div>':empty('尚未生成检测方案。品牌画像达到准备条件后，点击“根据品牌画像生成检测方案”。');
    const freezeNote=isApproved
      ?'<div class="notice" style="margin-top:12px"><strong>当前检测方案已经确认并冻结。</strong> 正式检测严格使用这一版问题。检测开始后不能原地修改，后续调整必须形成新的检测周期，保证结果可追溯和可比较。</div>'
      :'<div class="notice" style="margin-top:12px">确认前可以重新生成，也可以直接修订具体问题和检测目的。每次变化都会生成新版本并保留上一版；确认后才会按同一问题集展开五平台检测。</div>';
    const planOverview=set?'<div class="record-list" style="margin-top:14px">'
      +'<div class="record-item"><div><strong>检测目标</strong><p>验证品牌在目标客户真实需求、发现、比较、品牌核验、决策与风险判断场景中的 AI 可见度和推荐表现。</p></div><span class="status-chip">'+esc(revisionLabel)+'</span></div>'
      +'<div class="record-item"><div><strong>覆盖用户与决策阶段</strong><p>'+esc(String(Object.keys(personaById).length))+' 类目标人群 · '+esc([...journeyStages].join('、')||'待生成')+'</p></div></div>'
      +'<div class="record-item"><div><strong>品牌画像依据</strong><p>'+esc([...basisDimensions].join('、')||'待生成')+'</p></div></div>'
      +'<div class="record-item"><div><strong>AI 平台与执行方式</strong><p>'+esc(targetPlatforms.join('、'))+' · 每道问题独立新会话 · 确认后按同一问题口径执行</p></div></div>'
      +'<div class="record-item"><div><strong>方案质量检查</strong><p>问题数量 '+esc(String(queries.length))+'/12 · 画像驱动 '+esc(String(profileGrounded))+'/'+esc(String(queries.length))+' · 重复问题 '+esc(String(duplicateCount))+' · 画像维度 '+esc(String(basisDimensions.size))+'</p></div><span class="status-chip '+(qualityPassed?'ok':'warn')+'">'+(qualityPassed?'通过':'需检查')+'</span></div>'
      +'</div>':'';
    return '<section class="biz-card planning-review-card"><div class="biz-card-head"><div><h3>检测方案工作台</h3><p>完整查看、重新生成、人工修订并确认本次正式检测方案。实际发送到 AI 平台的问题以当前版本为唯一执行口径。</p></div><div class="action-row">'+planStatusChip+controls+'</div></div><div class="biz-card-body"><div class="biz-kpi-grid">'+kpi('当前版本',revisionLabel,'每次变更形成新版本')+kpi('检测问题',queries.length,'正式检测问题')+kpi('目标平台',targetPlatforms.length,'国内主流 AI 平台')+kpi('平台任务',prompts.length||queries.length*targetPlatforms.length,isApproved?'已物化':'确认后生成')+'</div>'+planningProfileBasisSummary(d,queries)+planOverview+'<div class="planning-question-section-head"><div><h4>完整检测问题</h4><p>逐条查看问题文本、检测目的、目标人群、决策阶段、品牌提示规则及品牌画像依据。</p></div><span>'+esc(String(queries.length))+' 条</span></div>'+questionList+freezeNote+(Object.keys(byType).length?'<div class="planning-type-summary"><span>问题结构</span><strong>'+esc(Object.entries(byType).map(([k,v])=>k+' '+v).join(' · '))+'</strong></div>':'')+planningVersionHistory(d,set)+'</div></section>';
  }

  function detectionDetail(d,stage){
    const runs=current(rows(d,'platform_test_run')),answers=current(rows(d,'raw_answer')),metrics=stage.metrics||{};
    const platforms={};Object.keys(PLATFORM_LABELS).forEach(p=>platforms[p]={runs:0,answers:0});
    runs.forEach(r=>{const p=r.platform_id;if(platforms[p])platforms[p].runs++});
    answers.filter(r=>['answered','refused'].includes(String(r.answer_status||''))).forEach(r=>{const p=r.platform_id;if(platforms[p])platforms[p].answers++});
    const controls=[];
    if(Number(metrics.manual_review_required_count||0)>0)controls.push('<button class="secondary-action" onclick="pipelineReviewDetectionEvidence()">审核完整检测证据</button>');
    if(metrics.can_confirm)controls.push('<button class="primary-action" onclick="pipelineConfirmDetection()">确认本轮检测完成</button>');
    return '<section class="biz-card"><div class="biz-card-head"><div><h3>五平台 AI 检测</h3><p>按已确认的检测问题逐项执行，并区分正常回答、拒答、失败和品牌未出现等情况。</p></div><div class="action-row">'+controls.join('')+'</div></div><div class="biz-card-body"><div class="biz-kpi-grid">'+kpi('覆盖平台',val(metrics.covered_platform_count,0)+' / '+val(metrics.target_platform_count,5),'豆包 / 深度求索 / 腾讯元宝 / 通义千问 / 月之暗面智能助手')+kpi('问题完成',val(metrics.completed_prompt_count,0)+' / '+val(metrics.planned_prompt_count,0),'全部计划问题均需完成')+kpi('已完成回答',metrics.answered_count||0,'包含正常回答与拒答记录')+kpi('待人工复核',metrics.manual_review_required_count||0,'需要运营确认')+'</div><div class="table-scroll" style="margin-top:14px"><table class="business-table"><thead><tr><th>平台</th><th>运行</th><th>已完成回答</th><th>状态</th></tr></thead><tbody>'+Object.entries(platforms).map(([p,m])=>'<tr><td>'+esc(PLATFORM_LABELS[p])+'</td><td>'+m.runs+'</td><td>'+m.answers+'</td><td>'+(m.answers?'<span class="status-chip ok">已完成</span>':'<span class="status-chip warn">待检测</span>')+'</td></tr>').join('')+'</tbody></table></div>'+(Number(metrics.missing_prompt_count||0)>0?'<div class="notice" style="margin-top:12px">仍有 '+esc(metrics.missing_prompt_count)+' 个计划测试问题未完成。请完成后再确认本轮检测。</div>':'')+'</div></section>';
  }

  function diagnosisDetail(d,stage){
    const g=d?.competitive_geo||{},o=g.overview||{},dims=d?.geo_dimension_assessment||{},tech=d?.geo_site_technical_audit||{},gaps=g.prompt_gaps||[],sources=g.source_gaps||[];
    const dimRows=(dims.dimensions||[]).map(x=>'<tr><td>'+esc(x.name||x.dimension_key)+'</td><td>'+esc(x.authority_level||'—')+'</td><td>'+esc(x.signal_state||'—')+'</td><td>'+esc(x.evidence_count||0)+'</td></tr>').join('');
    return '<section class="biz-card geo-intelligence-hero"><div class="biz-card-head"><div><h3>GEO 诊断与竞争情报</h3><p>把品牌可见度、推荐表现、显式排名、引用源、竞品差距、内容资产和技术站点问题放在一个诊断面板里。</p></div><div class="action-row"><button class="secondary-action" onclick="pipelineOpenReport()">查看当前诊断报告文件</button><button class="secondary-action" onclick="pipelineRunTechnicalAudit()">检查官网技术状态</button></div></div><div class="biz-card-body"><div class="biz-kpi-grid">'+kpi('自然发现率',pct(o.natural_discovery_mention_rate),'无品牌提示场景')+kpi('推荐场景出现率',pct(o.recommendation_surface_presence_rate),'推荐 / 比较 / 方案选择')+kpi('自有信源引用率',pct(o.owned_source_visibility_rate),'引用可观测回答')+kpi('AI 决策声量占比',pct(o.share_of_voice),'已确认竞品样本')+kpi('平均显式位次',o.average_explicit_rank===null||o.average_explicit_rank===undefined?'—':Number(o.average_explicit_rank).toFixed(2),'只统计明确编号排序')+kpi('官网技术检查',tech.status==='ready'?'已完成':tech.status==='running'?'检查中':'未检查','官网页面与访问状态')+'</div><div class="biz-grid-2" style="margin-top:14px"><div><h4>高优先级问题缺口</h4><div class="record-list">'+(gaps.slice(0,8).map(x=>'<div class="record-item"><strong>'+esc(x.query_text||x.query_id||'检测问题')+'</strong><p>机会点 '+esc(x.priority_points||0)+' · '+esc((x.platforms||[]).map(p=>PLATFORM_LABELS[p]||p).join('、'))+'</p></div>').join('')||empty('暂无高优先级问题缺口'))+'</div></div><div><h4>竞品引用源缺口</h4><div class="record-list">'+(sources.slice(0,8).map(x=>'<div class="record-item"><strong>'+esc(x.domain||'来源')+'</strong><p>'+esc(x.gap_observation_count||0)+' 次缺口 · '+esc(authorityLabel(x.authority_tier))+'</p></div>').join('')||empty('暂无可观测引用源缺口'))+'</div></div></div><div class="table-scroll" style="margin-top:14px"><table class="business-table"><thead><tr><th>24 维诊断</th><th>可信度</th><th>状态</th><th>证据</th></tr></thead><tbody>'+dimRows+'</tbody></table></div></div></section>';
  }

  function optimizationDetail(d,stage){
    const advisor=d?.geo_optimization_advisor||{},solution=latest(rows(d,'solution_package')),candidates=advisor.candidates||[];
    const categoryLabel=v=>({brand_identity:'品牌身份',structured_fact:'结构化事实',official_source:'权威信源',relationship_clarification:'关系澄清',freshness_update:'信息时效',persona_content:'Persona 内容',scenario_content:'场景内容',risk_boundary:'风险边界',competitor_differentiation:'竞品差异化'}[v]||v);
    const hypotheses=current(rows(d,'optimization_hypothesis'));
    return '<section class="biz-card optimization-advisor-card"><div class="biz-card-head"><div><h3>客户专属 GEO 优化方案</h3><p>把诊断发现转成可执行的优化方向，并明确需要修改的资产、负责人和验证方式。只有运营确认后的方案才会进入实施。</p></div></div><div class="biz-card-body"><div class="biz-kpi-grid">'+kpi('优化方向',advisor.candidate_count||0,'当前可执行建议')+kpi('高优先级',advisor.critical_high_count||0,'最高 / 高')+kpi('已确认建议',advisor.formalized_candidate_count||0,'可进入方案')+kpi('待验证假设',hypotheses.length,'需通过实施与复测验证')+kpi('优化方案',solution?'已形成':'待形成','客户当前方案')+'</div><div class="table-scroll" style="margin-top:14px"><table class="business-table"><thead><tr><th>优先级</th><th>优化方向</th><th>目标资产</th><th>验证方式</th><th>当前状态</th></tr></thead><tbody>'+(candidates.map(x=>'<tr><td>'+esc(x.priority||'—')+'</td><td><strong>'+esc(categoryLabel(x.action_category))+'</strong><br><small>'+esc(x.workstream||'')+'</small></td><td>'+esc((x.target_asset_types||[]).join('、')||'—')+'</td><td>'+esc(x.validation_method||'—')+'</td><td>'+(x.formal_recommended_action_exists?'<span class="status-chip ok">已确认建议</span>':x.hypothesis_materialization_ready?'<span class="status-chip ok">可提交确认</span>':'<span class="status-chip warn">还需补充验证依据</span>')+'</td></tr>').join('')||'<tr><td colspan="5">当前没有形成优化建议。</td></tr>')+'</tbody></table></div></div></section>';
  }

  function implementationDetail(d,stage){
    const actions=current(rows(d,'action')),evidence=current(rows(d,'action_evidence')),solution=latest(rows(d,'solution_package'));
    const evidenceCount=id=>evidence.filter(x=>String(x.action_id||'')===String(id||'')).length;
    const controls=a=>{
      const id=a.action_id||a.object_id||'',status=String(a.execution_status||'not_started'),count=evidenceCount(id),buttons=[];
      if(['not_started','scheduled'].includes(status))buttons.push('<button class="secondary-action compact" onclick="pipelineActionExecution(\''+esc(id)+'\',\'start\')">开始执行</button>');
      if(status==='blocked')buttons.push('<button class="secondary-action compact" onclick="pipelineActionExecution(\''+esc(id)+'\',\'resume\')">恢复执行</button>');
      if(status==='in_progress'){
        buttons.push('<button class="secondary-action compact" onclick="pipelineAddEvidence(\''+esc(id)+'\')">添加证据</button>');
        buttons.push('<button class="primary-action compact" onclick="pipelineActionExecution(\''+esc(id)+'\',\'submit\')">提交验收</button>');
      }
      if(status==='submitted_for_acceptance'){
        buttons.push('<button class="secondary-action compact" onclick="pipelineAddEvidence(\''+esc(id)+'\')">补充证据</button>');
        if(count>0)buttons.push('<button class="primary-action compact" onclick="pipelineAcceptAction(\''+esc(id)+'\',\'accepted\')">验收通过</button>');
        buttons.push('<button class="secondary-action compact" onclick="pipelineAcceptAction(\''+esc(id)+'\',\'needs_revision\')">退回修改</button>');
      }
      return buttons.join('');
    };
    const topAction=!actions.length&&solution?'<button class="primary-action" onclick="pipelineOpenImplementationMaterializer()">生成实施计划</button>':'';
    return '<section id="pipelineImplementationActions" class="biz-card"><div class="biz-card-head"><div><h3>优化实施与验收</h3><p>将已确认的优化方案拆解为具体实施任务。每项任务都要明确目标资产、执行状态、实施证据和验收结果。</p></div><div class="action-row">'+topAction+'</div></div><div class="biz-card-body">'+(actions.length?'<div class="table-scroll"><table class="business-table"><thead><tr><th>实施动作</th><th>目标资产</th><th>执行状态</th><th>证据</th><th>验收状态</th><th>操作</th></tr></thead><tbody>'+actions.map(a=>{const id=a.action_id||a.object_id||'';return '<tr><td><strong>'+esc(a.action_summary||a.action_type||id||'实施动作')+'</strong><br><small>'+esc(a.priority||'—')+'</small></td><td>'+esc(a.target_asset_id||'—')+'<br><small>'+esc(a.target_asset_version||'')+'</small></td><td>'+esc(executionStatusLabel(a.execution_status||'not_started'))+'</td><td>'+evidenceCount(id)+'</td><td>'+esc(executionStatusLabel(a.acceptance_status||'pending_review'))+'</td><td><div class="action-row">'+controls(a)+'</div></td></tr>'}).join('')+'</tbody></table></div>':empty('尚未生成实施任务。点击“生成实施计划”，在当前阶段完成目标资产与平台绑定。'))+'</div></section>';
  }

  function retestDetail(d,stage){
    const comps=current(rows(d,'retest_comparison')),outcome=latest(rows(d,'outcome_assessment')),plans=current(rows(d,'retest_plan')),runs=current(rows(d,'retest_run')),metrics=stage.metrics||{};
    const controls=metrics.can_finalize?'<button class="primary-action" onclick="pipelineFinalizeRetest()">完成复测并形成效果结论</button>':'';
    return '<section class="biz-card"><div class="biz-card-head"><div><h3>同口径效果复测</h3><p>复测只比较同一 Query、平台和评价口径。实施完成本身不能证明 AI 可见度或推荐表现提升。</p></div><div class="action-row">'+controls+'</div></div><div class="biz-card-body"><div class="biz-kpi-grid">'+kpi('复测计划',plans.length,'独立 RetestPlan')+kpi('复测运行',runs.length,'RetestRun')+kpi('可比复测',comps.length,'RetestComparison')+kpi('效果结论',outcome?val(outcome.outcome_status||outcome.assessment_status,'已形成'):'待形成','OutcomeAssessment')+'</div><div class="notice" style="margin-top:12px">基线证据与复测证据永久分离；不可比样本不进入效果结论。</div></div></section>';
  }

  function deliveryDetail(d,stage){
    const release=latest(rows(d,'diagnostic_report_release').filter(x=>String(x.release_status||'')==='released')),monitor=latest(rows(d,'monitoring_subscription').filter(x=>String(x.status||'')==='active'));
    const buttons=['<button class="secondary-action" onclick="pipelineOpenReport()">'+(release?'打开客户报告':'预览当前报告')+'</button>'];
    if(stage.state!=='blocked'&&!release)buttons.push('<button class="primary-action" onclick="pipelinePublishReport()">发布客户报告</button>');
    if(stage.state!=='blocked'&&release&&!monitor)buttons.push('<button class="primary-action" onclick="pipelineStartMonitoring()">启动持续监测</button>');
    if(stage.state!=='blocked'&&release&&monitor)buttons.push('<button class="primary-action" onclick="pipelineRunStage(\'delivery_monitoring\')">运行新一轮监测</button>');
    return '<section class="biz-card"><div class="biz-card-head"><div><h3>报告交付与持续优化</h3><p>在这里预览、发布和交付客户报告。交付完成后，可以安排持续监测和下一轮优化。</p></div><div class="action-row">'+buttons.join('')+'</div></div><div class="biz-card-body"><div class="biz-kpi-grid">'+kpi('客户报告',release?'已发布':'待发布','当前交付状态')+kpi('报告版本',release?.report_version||release?.semantic_version||'—','当前客户报告版本')+kpi('持续监测',monitor?'已启动':'未启动','后续服务状态')+kpi('下一次监测',monitor?.next_run_at||'待安排','沿用同一检测问题，便于前后比较')+'</div></div></section>';
  }

  function detailFor(d,stage){
    if(!stage)return empty('流水线阶段数据缺失。');
    if(stage.stage_key==='foundation')return foundationDetail(d,stage);
    if(stage.stage_key==='planning')return planningDetail(d,stage);
    if(stage.stage_key==='detection')return detectionDetail(d,stage);
    if(stage.stage_key==='diagnosis')return diagnosisDetail(d,stage);
    if(stage.stage_key==='optimization')return optimizationDetail(d,stage);
    if(stage.stage_key==='implementation')return implementationDetail(d,stage);
    if(stage.stage_key==='retest')return retestDetail(d,stage);
    return deliveryDetail(d,stage);
  }

  function fetchedResearchCandidateCount(d){
    const run=latest(rows(d,'customer_research_run'));let count=0;
    (run?.track_results||[]).forEach(track=>(track.candidates||[]).forEach(item=>{if(item.fetch_status==='fetched')count++}));
    return count;
  }

  function profileResearchProgressPanel(d){
    const run=profileResearchRun;
    if(!run||run.client!==clientId(d))return '';
    const running=run.status==='running',failed=run.status==='failed',done=run.status==='done';
    const stateClass=failed?' failed':done?' done':' running';
    const stateLabel=failed?'执行失败':done?'执行完成':'正在执行';
    const message=run.message||(running?'系统正在搜索公开网络、读取相关页面并整理品牌画像。完成后页面会自动刷新。':'');
    return '<section id="pipelineProfileResearchProgress" class="pipeline-research-progress'+stateClass+'"><div class="pipeline-research-progress-head"><div><span class="eyebrow">品牌企业画像检索</span><h3>'+esc(run.title||'全网检索并更新品牌画像')+'</h3><p>'+esc(message)+'</p></div><span class="pipeline-research-progress-state">'+esc(stateLabel)+'</span></div>'+(running?'<div class="pipeline-research-progress-track" aria-label="检索正在进行"><span></span></div>':'')+'<div class="pipeline-research-progress-meta"><span>状态：'+esc(stateLabel)+'</span><span id="pipelineProfileResearchElapsed">已运行 '+esc(formatElapsed(Date.now()-run.startedAt))+'</span><span>请勿重复点击</span></div></section>';
  }

  function updateProfileResearchProgressDom(){
    const run=profileResearchRun;
    if(!run)return;
    const elapsed=document.getElementById('pipelineProfileResearchElapsed');
    if(elapsed)elapsed.textContent='已运行 '+formatElapsed(Date.now()-run.startedAt);
    const button=document.getElementById('pipelineStagePrimaryAction');
    if(button&&run.status==='running'){
      button.disabled=true;
      button.textContent='检索进行中…';
      button.setAttribute('aria-busy','true');
    }
  }

  function renderProfileResearchProgressInline(){
    const d=window._clientData||{};
    const existing=document.getElementById('pipelineProfileResearchProgress');
    const html=profileResearchProgressPanel(d);
    if(existing){
      if(html)existing.outerHTML=html;else existing.remove();
    }else if(html){
      const action=document.querySelector('.pipeline-action-panel');
      if(action)action.insertAdjacentHTML('afterend',html);
    }
    updateProfileResearchProgressDom();
  }

  function startProfileResearchProgress(client,title){
    if(profileResearchTimer){clearInterval(profileResearchTimer);profileResearchTimer=null}
    profileResearchRun={
      client,
      status:'running',
      title,
      message:'系统正在搜索公开网络、读取相关页面并整理品牌画像。完成后页面会自动刷新。',
      startedAt:Date.now()
    };
    renderProfileResearchProgressInline();
    profileResearchTimer=setInterval(updateProfileResearchProgressDom,1000);
  }

  function finishProfileResearchProgress(status,message){
    if(profileResearchTimer){clearInterval(profileResearchTimer);profileResearchTimer=null}
    if(!profileResearchRun)return;
    profileResearchRun.status=status;
    profileResearchRun.message=message;
    renderProfileResearchProgressInline();
    const button=document.getElementById('pipelineStagePrimaryAction');
    if(button){
      button.removeAttribute('aria-busy');
      button.disabled=false;
    }
  }

  function stageActionPanel(d,stage){
    const profileRunning=stage?.stage_key==='foundation'&&profileResearchRun?.status==='running'&&profileResearchRun.client===clientId(d);
    const disabled=stage.state==='blocked'||profileRunning?'disabled':'';
    const next=stage.next_action||{};
    const kind=next.kind||'rerun_stage';
    const actionMap={
      approve_detection_plan:"pipelineApproveDetectionPlan()",
      review_detection_evidence:"pipelineReviewDetectionEvidence()",
      confirm_detection:"pipelineConfirmDetection()",
      run_site_technical_audit:"pipelineRunTechnicalAudit()",
      materialize_implementation:"pipelineOpenImplementationMaterializer()",
      focus_implementation:"pipelineFocusImplementation()",
      finalize_retest:"pipelineFinalizeRetest()",
      publish_report:"pipelinePublishReport()",
      start_monitoring:"pipelineStartMonitoring()",
      rerun_stage:"pipelineRunStage('"+esc(stage.stage_key)+"')"
    };
    const onclick=actionMap[kind]||actionMap.rerun_stage;
    const label=profileRunning?'检索进行中…':(next.label||stage.action_label||'运行本阶段');
    const blockerCopy=stage.state==='blocked'&&stage.blocked_reasons?.length
      ?'<small class="pipeline-blocker-copy">需先完成：'+esc(stage.blocked_reasons.join('；'))+'</small>'
      :'';
    return '<section class="pipeline-action-panel"><div><span class="eyebrow">当前阶段</span><h3>'+esc(stage.label)+'</h3><p>'+esc(operatorStageDescription(stage))+'</p>'+blockerCopy+'</div><div class="pipeline-action-buttons"><button id="pipelineStagePrimaryAction" class="primary-action" '+disabled+' '+(profileRunning?'aria-busy="true" ':'')+'onclick="'+onclick+'">'+esc(label)+'</button><button class="secondary-action" onclick="pipelineRefresh()">刷新数据</button></div></section>';
  }

  async function renderPipelineClient(id,followCurrent=false){
    window.syncNavigationState?.();
    setTitle('客户 GEO 服务','客户管理','查看客户从品牌资料、AI 检测、GEO 诊断、优化实施到报告交付的完整进度。');
    content.innerHTML='<div class="loading">正在加载客户 GEO 服务数据…</div>';
    try{
      const d=await api('/api/clients/'+encodeURIComponent(id));
      window._clientData=d;
      const p=d.geo_pipeline||{};
      if(followCurrent&&p.current_stage_key)setStage(p.current_stage_key);
      const key=activeStage(d),stage=stageByKey(d,key)||(p.stages||[])[0];
      if(!selectedStageKey||!stageByKey(d,selectedStageKey))setStage(stage?.stage_key||'foundation');
      if(stage?.stage_key&&state.clientTab!==stage.stage_key){state.clientTab=stage.stage_key;syncRoute({replace:true})}
      const name=d?.client?.display_name||latest(rows(d,'customer_attachment'))?.business_profile?.brandName||id;
      content.innerHTML='<div class="pipeline-client-head"><div><div class="eyebrow">客户 GEO 服务工作区</div><h2>'+esc(name)+'</h2><p>'+esc(d?.client?.industry||'行业待完善')+' · '+esc(d?.client?.website||'官网待完善')+'</p></div><div class="pipeline-overall"><span>当前阶段</span><strong>'+esc(p.current_stage_label||stage?.label||'品牌企业研究与完整画像')+'</strong></div></div>'+pipelineRail(d)+'<div style="height:14px"></div>'+stageActionPanel(d,stage)+profileResearchProgressPanel(d)+'<div style="height:14px"></div>'+gatePanel(stage)+'<div style="height:14px"></div>'+pendingTasksPanel(stage)+'<div style="height:14px"></div>'+detailFor(d,stage)+'<div style="height:14px"></div><section class="biz-card pipeline-principles"><div class="biz-card-head"><div><h3>服务说明</h3><p>用于运营人员推进客户项目时快速确认处理规则。</p></div></div><div class="biz-card-body"><div class="principle-grid"><div class="principle-item">✓ 未完成的资料和事项会明确提示</div><div class="principle-item">✓ 每个阶段完成后再进入下一阶段</div><div class="principle-item">✓ 历史结果保留，方便复盘和追踪</div><div class="principle-item">✓ 复测沿用一致的检测条件，便于比较</div></div></div></section>';
    }catch(e){
      content.innerHTML='<div class="notice danger-note">客户 GEO 服务加载失败：'+esc(String(e.message||e))+'</div>';
    }
  }

  window.pipelineSelectStage=function(key){setStage(key);state.clientTab=key;syncRoute();renderPipelineClient(state.client)};
  window.pipelineRefresh=function(){renderPipelineClient(state.client)};
  window.pipelineFocusImplementation=function(){
    const node=document.getElementById('pipelineImplementationActions');
    if(!node)return alert('当前没有可处理的实施动作。');
    node.scrollIntoView({behavior:'smooth',block:'start'});
    node.classList.add('pipeline-focus');
    setTimeout(()=>node.classList.remove('pipeline-focus'),1600);
  };
  window.pipelineRunStage=async function(stageKey){
    const d=window._clientData||{},stage=stageByKey(d,stageKey),client=clientId(d),project=projectId(d);
    if(!stage||!client||!project)return alert('客户或项目上下文缺失。');
    if(stage.state==='blocked')return alert((stage.blocked_reasons||['前置条件未完成']).join('；'));
    const isProfile=stage.stage_key==='foundation';
    if(isProfile&&profileResearchRun?.status==='running'&&profileResearchRun.client===client)return;
    const hasResearch=Boolean(researchEvidence(d).run_id);
    const msg=isProfile
      ?(hasResearch?'确认重新执行全网检索并更新品牌画像？系统会使用最新客户资料重新检索公开网络。':'确认开始全网检索并生成品牌画像？系统会根据客户资料自动检索公开网络并整理画像。')
      :'确认重新执行「'+stage.label+'」？系统会使用最新资料，并保留历史结果。';
    if(!confirm(msg))return;
    if(isProfile)startProfileResearchProgress(client,hasResearch?'正在重新检索并更新品牌画像':'正在全网检索并生成品牌画像');
    try{
      const result=await api('/api/clients/'+encodeURIComponent(client)+'/service-actions/rerun-stage',{method:'POST',body:JSON.stringify({project_id:project,stage_key:stage.canonical_stage_key})});
      if(isProfile){
        finishProfileResearchProgress('done','全网检索已完成，正在载入最新品牌画像。');
        if(state.view==='client'&&state.client===client){
          await new Promise(resolve=>setTimeout(resolve,350));
          profileResearchRun=null;
          await renderPipelineClient(client,true);
        }
      }else{
        alert('本阶段已完成：'+String(result?.status||'完成'));
        await renderPipelineClient(state.client,true);
      }
    }catch(e){
      if(isProfile){
        finishProfileResearchProgress('failed','检索未完成：'+String(e.message||e)+'。可重新执行；已成功保存的历史画像不会被覆盖。');
      }else alert(String(e.message||e));
    }
  };

  window.pipelineConfirmDetection=async function(){
    const d=window._clientData||{},client=clientId(d),project=projectId(d);
    if(!confirm('确认全部计划检测问题已经形成完整正式证据，并结束本轮基线检测吗？'))return;
    try{
      await api('/api/clients/'+encodeURIComponent(client)+'/service-actions/confirm-detection',{method:'POST',body:JSON.stringify({project_id:project})});
      alert('本轮检测已确认完成。');await renderPipelineClient(state.client,true);
    }catch(e){alert(String(e.message||e))}
  };

  window.pipelineReviewDetectionEvidence=async function(){
    const d=window._clientData||{},client=clientId(d),project=projectId(d);
    if(!confirm('确认你已经逐条核对完整可见回答与封存证据？该操作只会放行证据支持的诊断范围，不会自动补全引用或伪造事实。'))return;
    try{
      const r=await api('/api/clients/'+encodeURIComponent(client)+'/service-actions/review-detection-evidence',{method:'POST',body:JSON.stringify({project_id:project,confirm_full_answer_and_evidence_reviewed:true})});
      alert('检测证据审核完成：放行 '+String(r?.approved_answer_count||0)+' 条回答。');await renderPipelineClient(state.client,true);
    }catch(e){alert(String(e.message||e))}
  };

  window.pipelineOpenImplementationMaterializer=async function(){
    const d=window._clientData||{},client=clientId(d),project=projectId(d),solution=latest(rows(d,'solution_package'));
    if(!solution)return alert('尚未形成客户专属 GEO 优化方案。');
    let preflight;
    try{preflight=await api('/api/clients/'+encodeURIComponent(client)+'/service-actions/preflight?project_id='+encodeURIComponent(project))}
    catch(e){return alert(String(e.message||e))}
    const section=preflight?.implementation||{},pairs=section.baseline_candidate_pairs||[];
    if(section.status!=='ready_with_manual_input'||!pairs.length)return alert('实施前置条件尚未就绪：'+String(section.authority_boundary||'请先完成正式诊断基线。'));
    const workstreams=solution.workstreams||[];
    const baselineField=pairs.length>1?'<div class="field full"><label>正式检测基线 *</label><select name="baseline_pair">'+pairs.map((x,i)=>'<option value="'+esc(x.source_score_snapshot_id+'::'+x.source_observation_batch_id)+'">基线 '+(i+1)+' · '+esc(x.source_score_snapshot_id)+'</option>').join('')+'</select><small>存在多个正式基线时必须显式选择，系统不会猜测最新值。</small></div>':'';
    const platformFields='<div class="field full"><label>实施目标平台 *</label><div class="pipeline-checkboxes">'+Object.entries(PLATFORM_LABELS).map(([id,label])=>'<label><input type="checkbox" name="platform" value="'+id+'" checked> '+esc(label)+'</label>').join('')+'</div></div>';
    const assetFields=workstreams.map((w,i)=>'<fieldset class="pipeline-fieldset"><legend>'+esc(w.name||w.action_category||('工作流 '+(i+1)))+'</legend><p>'+esc(w.diagnostic_objective||'绑定该工作流实际要修改的客户资产。')+'</p><div class="field"><label>目标资产 ID *</label><input name="asset_id__'+esc(w.workstream_id)+'" placeholder="例如 official_homepage / faq_page / brand_profile" required></div><div class="field"><label>资产类型 *</label><select name="asset_type__'+esc(w.workstream_id)+'">'+(w.target_asset_types||['content_asset']).map(t=>'<option value="'+esc(t)+'">'+esc(t)+'</option>').join('')+'</select></div><div class="field"><label>当前版本 *</label><input name="asset_version__'+esc(w.workstream_id)+'" placeholder="例如 v1 / 2026-09-21" required></div></fieldset>').join('');
    modal('生成实施计划','<form id="pipelineMaterializeForm" class="form">'+baselineField+platformFields+'<div class="field full"><div class="notice">开始实施前，请确认本轮诊断结果、目标平台，以及需要优化的具体资产和当前版本。</div></div>'+assetFields+'<div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">取消</button><button class="primary">确认并生成实施计划</button></div></form>');
    document.getElementById('pipelineMaterializeForm').onsubmit=async function(e){
      e.preventDefault();const fd=new FormData(e.target),platforms=fd.getAll('platform');
      if(!platforms.length)return alert('至少选择一个实施目标平台。');
      let score=pairs[0].source_score_snapshot_id,batch=pairs[0].source_observation_batch_id;
      if(pairs.length>1){const parts=String(fd.get('baseline_pair')||'').split('::');score=parts[0]||'';batch=parts[1]||''}
      const bindings={};
      workstreams.forEach(w=>(w.tasks||[]).forEach(task=>{bindings[task.task_id]={target_asset_id:String(fd.get('asset_id__'+w.workstream_id)||'').trim(),target_asset_type:String(fd.get('asset_type__'+w.workstream_id)||'').trim(),target_asset_version:String(fd.get('asset_version__'+w.workstream_id)||'').trim()}}));
      try{
        await api('/api/clients/'+encodeURIComponent(client)+'/service-actions/materialize',{method:'POST',body:JSON.stringify({project_id:project,solution_package_id:solution.solution_package_id||solution.object_id,source_score_snapshot_id:score,source_observation_batch_id:batch,target_platform_scope:platforms,target_asset_bindings:bindings})});
        closeModal();alert('实施计划已生成。');await renderPipelineClient(state.client,true);
      }catch(err){alert(String(err.message||err))}
    };
  };

  window.pipelineActionExecution=async function(actionId,event){
    const d=window._clientData||{},client=clientId(d),label={start:'开始执行',resume:'恢复执行',submit:'提交验收'}[event]||event;
    if(!confirm('确认'+label+'该实施动作？'))return;
    try{
      await api('/api/clients/'+encodeURIComponent(client)+'/actions/'+encodeURIComponent(actionId)+'/execution',{method:'POST',body:JSON.stringify({event,summary:label+'：由 GeoGi 客户流水线记录。'})});
      await renderPipelineClient(state.client,true);
    }catch(e){alert(String(e.message||e))}
  };

  window.pipelineAddEvidence=function(actionId){
    modal('添加实施证据','<form id="pipelineEvidenceForm" class="form"><div class="field"><label>证据类型 *</label><select name="evidence_type"><option value="webpage_snapshot">网页快照</option><option value="structured_data">结构化数据</option><option value="publication_link">发布链接</option><option value="screenshot">截图</option><option value="content_asset">内容资产</option><option value="system_log">系统日志</option><option value="other">其他</option></select></div><div class="field"><label>资产 / 版本</label><input name="version_or_snapshot" placeholder="例如 v2 / 2026-09-21"></div><div class="field full"><label>证据引用 *</label><input name="evidence_reference" placeholder="URL、文件引用或受控工件 ID" required></div><div class="field full"><label>证据说明 *</label><textarea name="evidence_description" required placeholder="说明实际完成了什么，以及该证据如何验证实施动作。"></textarea></div><div class="field full"><label>核验备注</label><textarea name="verification_notes" placeholder="可选"></textarea></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">取消</button><button class="primary">保存已核验证据</button></div></form>');
    document.getElementById('pipelineEvidenceForm').onsubmit=async function(e){e.preventDefault();const payload=Object.fromEntries(new FormData(e.target).entries());try{await api('/api/clients/'+encodeURIComponent(clientId(window._clientData||{}))+'/actions/'+encodeURIComponent(actionId)+'/evidence',{method:'POST',body:JSON.stringify(payload)});closeModal();alert('实施证据已保存并进入验收链。');await renderPipelineClient(state.client)}catch(err){alert(String(err.message||err))}};
  };

  window.pipelineAcceptAction=async function(actionId,decision){
    let payload={decision,execution_matches_plan:true,target_asset_verified:true,brand_fact_consistency:true,new_conflict_detected:false,format_requirements_met:true};
    if(decision==='needs_revision'){
      const note=prompt('填写退回修改要求：','');if(!note)return;payload.revision_requirements=[note];payload.review_notes=note;
    }else if(!confirm('确认该动作与目标资产一致、证据有效，并允许进入复测准备状态？'))return;
    try{
      await api('/api/clients/'+encodeURIComponent(clientId(window._clientData||{}))+'/actions/'+encodeURIComponent(actionId)+'/acceptance',{method:'POST',body:JSON.stringify(payload)});
      await renderPipelineClient(state.client,true);
    }catch(e){alert(String(e.message||e))}
  };

  window.pipelineFinalizeRetest=async function(){
    const d=window._clientData||{},client=clientId(d),project=projectId(d);
    if(!confirm('确认当前复测采集已完成，并基于同口径证据形成 RetestComparison 与 OutcomeAssessment？'))return;
    try{
      await api('/api/clients/'+encodeURIComponent(client)+'/projects/'+encodeURIComponent(project)+'/finalize-retest',{method:'POST',body:'{}'});
      alert('复测已完成并形成效果结论。');await renderPipelineClient(state.client,true);
    }catch(e){alert(String(e.message||e))}
  };

  window.pipelinePublishReport=async function(){
    const d=window._clientData||{},client=clientId(d),project=projectId(d);
    if(!confirm('确认固化并发布当前正式 GEO 诊断报告？后台预览、下载和客户前台将使用同一个 PDF 工件。'))return;
    try{
      await api('/api/clients/'+encodeURIComponent(client)+'/projects/'+encodeURIComponent(project)+'/publish-baseline-diagnostic-report',{method:'POST',body:'{}'});
      alert('正式 GEO 报告已发布。');await renderPipelineClient(state.client,true);
    }catch(e){alert(String(e.message||e))}
  };

  window.pipelineStartMonitoring=function(){
    const date=new Date(Date.now()+30*24*60*60*1000),local=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
    modal('启动持续 GEO 监测','<form id="pipelineMonitoringForm" class="form"><div class="field"><label>监测频率 *</label><select name="cadence"><option value="weekly">每周</option><option value="biweekly">每两周</option><option value="monthly" selected>每月</option><option value="quarterly">每季度</option><option value="manual">手动</option></select></div><div class="field"><label>下一次运行 *</label><input type="datetime-local" name="next_run_at" value="'+local+'" required></div><div class="field full"><div class="notice">持续监测沿用同一检测问题集和平台范围，保证前后结果可比。新研究结果需审核后才会影响下一轮检测方案。</div></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">取消</button><button class="primary">激活持续监测</button></div></form>');
    document.getElementById('pipelineMonitoringForm').onsubmit=async function(e){e.preventDefault();const fd=new FormData(e.target),raw=String(fd.get('next_run_at')||'');const next=new Date(raw);if(Number.isNaN(next.getTime()))return alert('请选择有效的下一次运行时间。');try{await api('/api/clients/'+encodeURIComponent(clientId(window._clientData||{}))+'/service-actions/monitoring',{method:'POST',body:JSON.stringify({project_id:projectId(window._clientData||{}),cadence:String(fd.get('cadence')||'monthly'),next_run_at:next.toISOString()})});closeModal();alert('持续监测已激活。');await renderPipelineClient(state.client)}catch(err){alert(String(err.message||err))}};
  };

  window.pipelineRunTechnicalAudit=async function(){
    const d=window._clientData||{},client=clientId(d),project=projectId(d);if(!client||!project)return alert('客户或项目上下文缺失。');
    try{
      const r=await api('/api/clients/'+encodeURIComponent(client)+'/projects/'+encodeURIComponent(project)+'/site-technical-audit',{method:'POST',body:'{}'});
      alert('官网技术检查完成：通过 '+String(r?.audit?.passed_check_count||0)+'，失败 '+String(r?.audit?.failed_check_count||0)+'。');
      await renderPipelineClient(state.client,true);
    }catch(e){alert(String(e.message||e))}
  };

  window.pipelineDecideTask=function(id){if(!id)return;if(typeof decideTask==='function')return decideTask(id);alert('待办处理入口不可用。')};

  window.pipelineRegenerateDetectionQuestions=async function(){
    const d=window._clientData||{},client=clientId(d),project=projectId(d),stage=stageByKey(d,'planning');
    if(!client||!project||!stage)return alert('客户或项目上下文缺失。');
    const set=latest(current(rows(d,'query_set')));
    if(set&&String(set.review_status||'')==='approved')return alert('当前问题集已经确认并冻结。若要改变检测口径，请开启新的检测周期。');
    const hasSet=Boolean(set);
    const message=hasSet
      ?'确认根据最新品牌企业画像重新生成检测方案？\n\n当前版本会完整保留到版本记录，新版本重新进入待确认状态。'
      :'确认根据当前品牌企业画像生成检测方案？';
    if(!confirm(message))return;
    try{
      await api('/api/clients/'+encodeURIComponent(client)+'/service-actions/rerun-stage',{method:'POST',body:JSON.stringify({project_id:project,stage_key:stage.canonical_stage_key})});
      await renderPipelineClient(client,true);
    }catch(e){alert(String(e.message||e))}
  };

  window.pipelineReviseDetectionPlan=function(){
    const d=window._clientData||{},client=clientId(d),project=projectId(d);
    const set=latest(current(rows(d,'query_set')).filter(x=>['pending_review','changes_requested'].includes(String(x.review_status||''))));
    if(!client||!project||!set)return alert('当前没有可修订的待确认检测方案。');
    const queries=planningOrderedQueries(d,set);
    if(queries.length!==12)return alert('当前检测问题不完整，不能进入人工修订。请先重新生成方案。');
    const fields=queries.map((q,i)=>'<div class="field full"><label>'+(i+1)+'. '+esc(planningQueryTypeLabel(q.query_type))+'</label><textarea name="query_text_'+i+'" rows="3" required>'+esc(q.query_text||'')+'</textarea><small>检测目的</small><textarea name="query_intent_'+i+'" rows="2" required>'+esc(q.query_intent||'')+'</textarea></div>').join('');
    modal('修订检测方案','<form id="pipelineDetectionRevisionForm" class="form-grid"><div class="field full"><div class="notice">本次修订只修改待确认方案，不会改动品牌画像。保存后自动形成新版本，并完整保留当前版本。若需要修改目标客户、产品、竞品等基础事实，请先回到品牌画像修订后再重新生成。</div></div><div class="field full"><label>修订原因 *</label><textarea name="revision_reason" rows="2" required placeholder="例如：问题 03 过于宽泛，需要更贴近客户真实决策场景"></textarea></div>'+fields+'<div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">取消</button><button class="primary">保存为新版本</button></div></form>');
    document.getElementById('pipelineDetectionRevisionForm').onsubmit=async function(e){
      e.preventDefault();
      const fd=new FormData(e.target),reason=String(fd.get('revision_reason')||'').trim();
      const revised=queries.map((q,i)=>({
        query_id:String(q.query_id||q.object_id||''),
        query_text:String(fd.get('query_text_'+i)||'').trim(),
        query_intent:String(fd.get('query_intent_'+i)||'').trim()
      }));
      if(!reason)return alert('请填写修订原因。');
      if(revised.some(x=>!x.query_text||!x.query_intent))return alert('每一道检测问题和检测目的都不能为空。');
      try{
        const result=await api('/api/clients/'+encodeURIComponent(client)+'/projects/revise-detection-plan',{method:'POST',body:JSON.stringify({project_id:project,revision_reason:reason,queries:revised})});
        closeModal();
        alert('检测方案已保存为 V'+String(result?.semantic_version||result?.revision_number||'新版本')+'，上一版已保留。');
        await renderPipelineClient(client,true);
      }catch(err){alert(String(err.message||err))}
    };
  };

  window.pipelineApproveDetectionPlan=async function(){
    const d=window._clientData||{},client=clientId(d),project=projectId(d),set=latest(rows(d,'query_set'));
    if(!set)return alert('尚未生成检测方案。');
    const revision=planningRevisionMeta(set);
    const event=[...(d.timeline||[])].sort((a,b)=>String(b.occurred_at||'').localeCompare(String(a.occurred_at||''))).find(x=>['detection_plan_revised','detection_plan_candidates_prepared'].includes(String(x.operation_type||'')));
    const fingerprint=revision.candidate_fingerprint||event?.details?.candidate_fingerprint||'';
    if(!fingerprint)return alert('未找到当前方案版本指纹，请先重新生成或保存一次修订。');
    if(!confirm('确认当前页面展示的完整检测方案可以作为正式检测口径吗？\n\n确认后当前版本将冻结，并按同一问题集展开到五个平台。'))return;
    try{
      await api('/api/clients/'+encodeURIComponent(client)+'/projects/approve-detection-plan',{method:'POST',body:JSON.stringify({project_id:project,candidate_fingerprint:fingerprint})});
      alert('检测方案已确认并冻结。');await renderPipelineClient(state.client,true);
    }catch(e){alert(String(e.message||e))}
  };

  function profilePathValue(root,path){
    return String(path||'').split('.').reduce((value,key)=>value&&typeof value==='object'?value[key]:undefined,root);
  }
  window.pipelineEditBrandProfileField=function(path,label,fieldType){
    const d=window._clientData||{},profile=d.brand_enterprise_profile||{},meta=(d.brand_profile_field_provenance||{})[path]||null;
    const currentValue=profilePathValue(profile,path);
    const listValue=profileValues(currentValue).join('\n');
    const priceOptions=[['free','免费'],['budget','低价'],['value','高性价比'],['mid_market','中端'],['premium','高端'],['luxury','奢侈 / 顶级'],['enterprise','企业级'],['custom_quote','定制报价'],['varies_by_offer','按产品 / 服务变化'],['unknown','待确认']];
    let control='';
    if(fieldType==='list'){
      control='<textarea name="value" rows="4" placeholder="每行一项">'+esc(listValue)+'</textarea><small>多项内容每行填写一项。</small>';
    }else if(fieldType==='price'){
      const selected=String(currentValue||'unknown');
      control='<select name="value">'+priceOptions.map(([v,t])=>'<option value="'+v+'" '+(selected===v?'selected':'')+'>'+t+'</option>').join('')+'</select>';
    }else if(fieldType==='url'){
      control='<input name="value" type="url" value="'+esc(String(currentValue||''))+'" placeholder="https://example.com">';
    }else{
      control='<input name="value" type="text" value="'+esc(String(currentValue||''))+'" placeholder="请输入'+esc(label)+'">';
    }
    const sourceNote=meta?'<span class="profile-field-source operator">已人工修订</span>':'<span class="profile-field-source neutral">当前为系统识别结果</span>';
    modal('编辑 '+label,'<form id="pipelineProfileFieldEditForm" class="form-grid profile-field-edit-form"><div class="field full"><label>'+esc(label)+'</label>'+control+'</div><div class="field full"><div class="profile-edit-guidance">'+sourceNote+'<p>直接修订当前画像字段。保存后立即显示为人工修订值；清空并保存则恢复系统当前识别结果。</p></div></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">取消</button><button class="primary">保存</button></div></form>');
    document.getElementById('pipelineProfileFieldEditForm').onsubmit=async function(e){
      e.preventDefault();
      const fd=new FormData(e.target),raw=fd.get('value');
      const value=fieldType==='list'?pipelineSplitList(raw):String(raw??'').trim();
      const payload={project_id:projectId(window._clientData||{}),field_path:path,value:value};
      try{
        await api('/api/clients/'+encodeURIComponent(clientId(window._clientData||{}))+'/brand-profile-field',{method:'POST',body:JSON.stringify(payload)});
        closeModal();
        await renderPipelineClient(state.client);
      }catch(err){alert(String(err.message||err))}
    };
  };

  function pipelineSplitList(value){return String(value||'').split(/[，,；;\n]+/).map(x=>x.trim()).filter(Boolean)}
  window.pipelineOpenReport=async function(){
    const d=window._clientData||{},client=encodeURIComponent(clientId(d)),project=encodeURIComponent(projectId(d)),release=latest(rows(d,'diagnostic_report_release').filter(x=>String(x.release_status||'')==='released'));
    if(!client||!project)return alert('客户或项目上下文缺失。');
    const url='/api/clients/'+client+'/projects/'+project+'/diagnosis-report?format=pdf'+(release?'&source=published':'');
    try{
      const headers={};if(state.token)headers.Authorization='Bearer '+state.token;
      const response=await fetch(url,{headers,cache:'no-store'});if(!response.ok)throw new Error('报告读取失败：'+response.status);
      const blob=await response.blob(),objectUrl=URL.createObjectURL(blob),win=window.open(objectUrl,'_blank','noopener');if(!win)alert('浏览器拦截了新窗口。');setTimeout(()=>URL.revokeObjectURL(objectUrl),120000);
    }catch(e){alert(String(e.message||e))}
  };

  const CORE_VIEWS=new Set([
    'dashboard','clients','intakes','client','miniprogram-users',
    'channel-overview','channel-manage','channel-statistics',
    'data-center','data-center-customers','data-center-business','data-center-payments',
    'ai-platform-daily','geo-competitive-daily','competitive-intelligence'
  ]);
  window.render=async function(){
    if(!CORE_VIEWS.has(state.view)){
      state.view='dashboard';
      state.client=null;
    }
    if(state.view==='client')return renderPipelineClient(state.client);
    return legacyRender();
  };

  setTimeout(function(){
    document.body.classList.add('geogi-pipeline-ui');
    const title=document.getElementById('pageEyebrow');if(title&&state.view==='client')title.textContent='客户管理';
  },0);
})();