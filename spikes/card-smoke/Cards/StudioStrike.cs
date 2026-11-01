using BaseLib.Abstracts;
using BaseLib.Utils;
using Godot;
using MegaCrit.Sts2.Core.Commands;
using MegaCrit.Sts2.Core.Entities.Cards;
using MegaCrit.Sts2.Core.GameActions.Multiplayer;
using MegaCrit.Sts2.Core.Localization.DynamicVars;
using MegaCrit.Sts2.Core.Models;
using MegaCrit.Sts2.Core.Models.CardPools;
using MegaCrit.Sts2.Core.Models.Cards;
using MegaCrit.Sts2.Core.ValueProps;

namespace ModStudioCardSmoke.Cards;

[Pool(typeof(IroncladCardPool))]
public sealed class StudioStrike() : CustomCardModel(1, CardType.Attack, CardRarity.Common, TargetType.AnyEnemy)
{
    protected override IEnumerable<DynamicVar> CanonicalVars => [new DamageVar(6, ValueProp.Move)];

    public override List<(string, string)> Localization => new CardLoc(
        "工坊试击", "造成 {Damage:diff()} 点伤害。");

    public override Texture2D CustomPortrait => ModelDb.Card<StrikeIronclad>().Portrait;
    public override string PortraitPath => ModelDb.Card<StrikeIronclad>().PortraitPath;
    public override string BetaPortraitPath => ModelDb.Card<StrikeIronclad>().BetaPortraitPath;

    protected override async Task OnPlay(PlayerChoiceContext choiceContext, CardPlay cardPlay)
    {
        var target = cardPlay.Target ?? throw new InvalidOperationException("StudioStrike requires an enemy target.");
        var hpBefore = target.CurrentHp;
        var blockBefore = target.Block;
        await DamageCmd.Attack(DynamicVars.Damage.BaseValue)
            .FromCard(this, cardPlay)
            .Targeting(target)
            .Execute(choiceContext);
        Main.Logger.Info($"StudioStrike played: baseDamage={DynamicVars.Damage.BaseValue}, hp={hpBefore}->{target.CurrentHp}, block={blockBefore}->{target.Block}.");
    }

    protected override void OnUpgrade() => DynamicVars.Damage.UpgradeValueBy(3);
}
